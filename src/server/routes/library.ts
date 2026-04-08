import { type Context, Hono } from 'hono'
import type { AlbumCoverage } from '@/core/library/album-coverage'
import type { LibraryHealthService } from '@/core/library/health'
import type { SkyHookWarmer } from '@/core/library/skyhook-warmer'
import type { LibrarySyncStore } from '@/core/library/store'
import { SOURCE_NOT_CONFIGURED_ERROR, type SyncOrchestrator } from '@/core/library/sync'
import type { HealthCheckId } from '@/core/library/types'
import { errMsg } from '@/core/validation'
import { resolveAdmin } from '@/server/middleware/admin-guard'
import { rateLimiter } from '@/server/middleware/rate-limit'
import type { HonoEnv } from '@/server/types'

const VALID_CHECK_IDS: Set<string> = new Set([
  'missing-metadata',
  'unmonitored',
  'missing-albums',
  'duplicate-artists',
  'genre-gaps',
  'image-gaps',
])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type LibraryRouteDeps = {
  libraryHealth: LibraryHealthService
  skyhookWarmer?: SkyHookWarmer | null
  librarySync: SyncOrchestrator
  librarySyncStore: LibrarySyncStore
  albumCoverage: {
    getCoverageForArtist: (userId: number, artistMbid: string) => Promise<AlbumCoverage>
  }
  getUserById: (id: number) => Promise<{ isAdmin: boolean } | null>
}

export function libraryRoutes(deps: LibraryRouteDeps) {
  const app = new Hono<HonoEnv>()

  function requireUser(c: Context<HonoEnv>) {
    const userId = c.get('userId')
    if (!userId) {
      return { ok: false as const, response: c.json({ error: 'Auth required' }, 401) }
    }
    return { ok: true as const, userId }
  }

  function requireSessionUser(c: Context<HonoEnv>) {
    const auth = requireUser(c)
    if (!auth.ok) return auth
    if (c.get('legacyTokenAuth')) {
      return {
        ok: false as const,
        response: c.json({ error: 'Session authentication required' }, 403),
      }
    }
    return auth
  }

  async function requireAdmin(c: Context<HonoEnv>) {
    if (c.get('authSkipped')) {
      return { ok: true as const, userId: c.get('userId') ?? 0 }
    }
    const auth = requireUser(c)
    if (!auth.ok) return auth
    const isAdmin = await resolveAdmin(
      auth.userId,
      deps.getUserById,
      false,
      c.get('legacyTokenAuth'),
    )
    if (!isAdmin) {
      return { ok: false as const, response: c.json({ error: 'Admin access required' }, 403) }
    }
    return auth
  }

  // GET /api/library/health -- return cached results + scanning status
  app.get('/api/library/health', async (c) => {
    const auth = await requireAdmin(c)
    if (!auth.ok) return auth.response
    const checks = deps.libraryHealth.getLastResults() ?? []
    return c.json({ checks, scanning: deps.libraryHealth.scanning })
  })

  // POST /api/library/health/scan -- kick off background scan, return 202
  app.post('/api/library/health/scan', async (c) => {
    const auth = await requireAdmin(c)
    if (!auth.ok) return auth.response
    deps.libraryHealth.startScan()
    return c.json({ scanning: true }, 202)
  })

  // POST /api/library/health/:checkId/fix -- trigger fix for a check
  app.post('/api/library/health/:checkId/fix', async (c) => {
    const auth = await requireAdmin(c)
    if (!auth.ok) return auth.response
    const checkId = c.req.param('checkId')
    if (!VALID_CHECK_IDS.has(checkId)) {
      return c.json({ error: 'Invalid check ID' }, 400)
    }
    try {
      const progress = await deps.libraryHealth.fixCheck(checkId as HealthCheckId)
      return c.json(progress)
    } catch (err: unknown) {
      return c.json({ error: errMsg(err) }, 400)
    }
  })

  // GET /api/library/stats -- library statistics
  app.get('/api/library/stats', async (c) => {
    const auth = await requireAdmin(c)
    if (!auth.ok) return auth.response
    const stats = await deps.libraryHealth.getStats()
    return c.json(stats)
  })

  // POST /api/library/warm -- trigger background warming for a batch of MBIDs
  app.post('/api/library/warm', async (c) => {
    const auth = await requireAdmin(c)
    if (!auth.ok) return auth.response
    if (!deps.skyhookWarmer) {
      return c.json({ error: 'SkyHook warming not available (Lidarr not configured)' }, 400)
    }
    const body = await c.req.json()
    const rawMbids = body.mbids
    if (!Array.isArray(rawMbids) || rawMbids.length === 0) {
      return c.json({ error: 'mbids array required' }, 400)
    }
    const mbids = rawMbids.filter((m): m is string => typeof m === 'string')
    if (mbids.length === 0) {
      return c.json({ error: 'mbids array required' }, 400)
    }
    const batch = mbids.slice(0, 50) // Limit batch size
    for (const mbid of batch) {
      deps.skyhookWarmer.warmInBackground(mbid)
    }
    return c.json({ queued: batch.length }, 202)
  })

  // GET /api/library/warm/status -- check warm status for MBIDs
  app.get('/api/library/warm/status', async (c) => {
    const auth = await requireAdmin(c)
    if (!auth.ok) return auth.response
    if (!deps.skyhookWarmer) {
      return c.json({ statuses: {} })
    }
    const mbidsParam = c.req.query('mbids') ?? ''
    const mbids = mbidsParam.split(',').filter(Boolean).slice(0, 100)
    const statuses: Record<string, string> = {}
    for (const mbid of mbids) {
      statuses[mbid] = deps.skyhookWarmer.getStatus(mbid)
    }
    return c.json({ statuses })
  })

  // GET /api/library/sources -- per-source sync state for current user + global rows
  app.get('/api/library/sources', async (c) => {
    const auth = requireSessionUser(c)
    if (!auth.ok) return auth.response
    const sources = await deps.librarySyncStore.listSyncStateForUser(auth.userId)
    return c.json({ sources })
  })

  // POST /api/library/sync -- manual "Sync now", rate-limited 5/min
  app.use('/api/library/sync', rateLimiter({ windowMs: 60_000, max: 5, keyPrefix: 'libsync' }))
  app.post('/api/library/sync', async (c) => {
    const auth = await requireAdmin(c)
    if (!auth.ok) return auth.response
    const raw = await c.req.json().catch(() => null)
    const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const source = typeof body.source === 'string' ? body.source : undefined
    if (source) {
      let result = await deps.librarySync.syncSpecificSource(auth.userId, source, { force: true })
      // Per-user source not configured -- retry as a global source. This is safe today because
      // (a) the route is admin-gated and (b) per-user/global source IDs do not overlap. If a
      // future source becomes both per-user AND global, restrict this fallback to known-global
      // IDs to avoid letting per-user calls trigger global syncs they shouldn't reach.
      if (result.status === 'failed' && result.error.includes(SOURCE_NOT_CONFIGURED_ERROR)) {
        result = await deps.librarySync.syncSpecificSource(null, source, { force: true })
      }
      const status = result.status === 'completed' ? 200 : result.status === 'failed' ? 502 : 202
      return c.json(result, status)
    } else {
      await deps.librarySync.syncGlobal({ force: true })
      const summary = await deps.librarySync.syncForUser(auth.userId, { force: true })
      return c.json(summary, 202)
    }
  })

  // GET /api/library/unreconciled -- rows where mbid IS NULL for current user + global
  app.get('/api/library/unreconciled', async (c) => {
    const auth = await requireAdmin(c)
    if (!auth.ok) return auth.response
    const items = await deps.librarySyncStore.listUnreconciledForUser(auth.userId)
    return c.json({ items })
  })

  app.get('/api/library/album-coverage/:artistMbid', async (c) => {
    const auth = requireSessionUser(c)
    if (!auth.ok) return auth.response
    const artistMbid = c.req.param('artistMbid')
    if (!UUID_RE.test(artistMbid)) {
      return c.json({ error: 'artistMbid must be a valid UUID' }, 400)
    }
    const coverage = await deps.albumCoverage.getCoverageForArtist(auth.userId, artistMbid)
    return c.json(coverage)
  })

  app.get('/api/library/unreconciled-albums', async (c) => {
    const auth = await requireAdmin(c)
    if (!auth.ok) return auth.response
    const items = await deps.librarySyncStore.listUnreconciledAlbumsForUser(auth.userId)
    return c.json({ items })
  })

  // POST /api/library/overrides -- create/update an MBID override
  app.post('/api/library/overrides', async (c) => {
    const auth = await requireAdmin(c)
    if (!auth.ok) return auth.response
    const raw = await c.req.json().catch(() => null)
    const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const { source, sourceArtistId, correctMbid, note } = body
    if (typeof source !== 'string' || !source) {
      return c.json({ error: 'source is required' }, 400)
    }
    if (typeof sourceArtistId !== 'string' || !sourceArtistId) {
      return c.json({ error: 'sourceArtistId is required' }, 400)
    }
    const mbid = correctMbid === '' || correctMbid == null ? null : (correctMbid as string)
    if (mbid !== null && !UUID_RE.test(mbid)) {
      return c.json({ error: 'correctMbid must be a valid UUID' }, 400)
    }
    await deps.librarySyncStore.upsertOverride(
      auth.userId,
      source,
      sourceArtistId,
      mbid,
      typeof note === 'string' ? note : undefined,
    )
    return c.json({ ok: true })
  })

  app.post('/api/library/album-overrides', async (c) => {
    const auth = await requireAdmin(c)
    if (!auth.ok) return auth.response
    const raw = await c.req.json().catch(() => null)
    const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const { source, sourceAlbumId, correctAlbumMbid, note } = body
    if (typeof source !== 'string' || !source) {
      return c.json({ error: 'source is required' }, 400)
    }
    if (typeof sourceAlbumId !== 'string' || !sourceAlbumId) {
      return c.json({ error: 'sourceAlbumId is required' }, 400)
    }
    const albumMbid =
      correctAlbumMbid === '' || correctAlbumMbid == null ? null : (correctAlbumMbid as string)
    if (albumMbid !== null && !UUID_RE.test(albumMbid)) {
      return c.json({ error: 'correctAlbumMbid must be a valid UUID' }, 400)
    }
    await deps.librarySyncStore.upsertAlbumOverride(
      auth.userId,
      source,
      sourceAlbumId,
      albumMbid,
      typeof note === 'string' ? note : undefined,
    )
    return c.json({ ok: true })
  })

  // DELETE /api/library/overrides/:source/:sourceArtistId -- remove an override
  app.delete('/api/library/overrides/:source/:sourceArtistId', async (c) => {
    const auth = await requireAdmin(c)
    if (!auth.ok) return auth.response
    const source = c.req.param('source')
    const sourceArtistId = c.req.param('sourceArtistId')
    await deps.librarySyncStore.deleteOverride(auth.userId, source, sourceArtistId)
    return c.json({ ok: true })
  })

  // POST /api/library/reconcile -- re-run reconciler for current user (forced syncForUser)
  // Note: a "reconcile only without re-fetch" path is a follow-up task.
  app.post('/api/library/reconcile', async (c) => {
    const auth = await requireAdmin(c)
    if (!auth.ok) return auth.response
    deps.librarySync.syncForUser(auth.userId, { force: true }).catch((err: unknown) => {
      console.error('[library/reconcile] sync error:', errMsg(err))
    })
    return c.json({ ok: true }, 202)
  })

  return app
}
