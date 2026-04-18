import { Hono } from 'hono'
import type { AlbumCoverage } from '@/core/library/album-coverage'
import type { LibraryHealthService } from '@/core/library/health'
import type { SkyHookWarmer } from '@/core/library/skyhook-warmer'
import type { LibrarySyncStore } from '@/core/library/store'
import { SOURCE_NOT_CONFIGURED_ERROR, type SyncOrchestrator } from '@/core/library/sync'
import type { HealthCheckId } from '@/core/library/types'
import { errMsg } from '@/core/validation'
import { requireAdmin, requireSessionUser } from '@/server/helpers/require-user'
import { rateLimiter } from '@/server/middleware/rate-limit'
import {
  libraryAlbumOverrideSchema,
  libraryOverrideSchema,
  librarySyncSchema,
  libraryWarmSchema,
} from '@/server/schemas/library'
import { zJson } from '@/server/schemas/validator'
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
  getSettings: () => Promise<{ librarySyncIntervalHours?: number } | null>
  albumCoverage: {
    getCoverageForArtist: (userId: number, artistMbid: string) => Promise<AlbumCoverage>
  }
  getUserById: (id: number) => Promise<{ isAdmin: boolean } | null>
}

export function libraryRoutes(deps: LibraryRouteDeps) {
  const app = new Hono<HonoEnv>()

  const adminGate = (c: Parameters<typeof requireAdmin>[0]) => requireAdmin(c, deps.getUserById)

  // GET /api/library/health - return cached results + scanning status
  app.get('/api/library/health', async (c) => {
    const auth = await adminGate(c)
    if (!auth.ok) return auth.response
    const [state, settings] = await Promise.all([deps.libraryHealth.getState(), deps.getSettings()])
    return c.json({
      checks: state?.checks ?? [],
      scanning: deps.libraryHealth.scanning,
      lastStartedAt: state?.lastStartedAt?.toISOString() ?? null,
      lastCompletedAt: state?.lastCompletedAt?.toISOString() ?? null,
      lastError: state?.lastError ?? null,
      syncIntervalHours: settings?.librarySyncIntervalHours ?? 6,
    })
  })

  // POST /api/library/health/scan - kick off background scan, return 202
  app.post('/api/library/health/scan', async (c) => {
    const auth = await adminGate(c)
    if (!auth.ok) return auth.response
    deps.libraryHealth.startScan()
    return c.json({ scanning: true }, 202)
  })

  // POST /api/library/health/:checkId/fix - trigger fix for a check
  app.post('/api/library/health/:checkId/fix', async (c) => {
    const auth = await adminGate(c)
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

  // GET /api/library/stats - library statistics
  app.get('/api/library/stats', async (c) => {
    const auth = await adminGate(c)
    if (!auth.ok) return auth.response
    const stats = await deps.libraryHealth.getStats()
    return c.json(stats)
  })

  // POST /api/library/warm - trigger background warming for a batch of MBIDs
  app.post('/api/library/warm', zJson(libraryWarmSchema), async (c) => {
    const auth = await adminGate(c)
    if (!auth.ok) return auth.response
    if (!deps.skyhookWarmer) {
      return c.json({ error: 'SkyHook warming not available (Lidarr not configured)' }, 400)
    }
    const { mbids } = c.req.valid('json')
    const batch = mbids.slice(0, 50) // Runtime cap; schema allows up to 200 for future use.
    for (const mbid of batch) {
      deps.skyhookWarmer.warmInBackground(mbid)
    }
    return c.json({ queued: batch.length }, 202)
  })

  // GET /api/library/warm/status - check warm status for MBIDs
  app.get('/api/library/warm/status', async (c) => {
    const auth = await adminGate(c)
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

  // GET /api/library/sources - per-source sync state for current user + global rows
  app.get('/api/library/sources', async (c) => {
    const auth = requireSessionUser(c)
    if (!auth.ok) return auth.response
    const sources = await deps.librarySyncStore.listSyncStateForUser(auth.userId)
    return c.json({ sources })
  })

  // POST /api/library/sync - manual "Sync now", rate-limited 5/min
  app.use('/api/library/sync', rateLimiter({ windowMs: 60_000, max: 5, keyPrefix: 'libsync' }))
  app.post('/api/library/sync', zJson(librarySyncSchema), async (c) => {
    const auth = await adminGate(c)
    if (!auth.ok) return auth.response
    const { source } = c.req.valid('json')
    if (source) {
      let result = await deps.librarySync.syncSpecificSource(auth.userId, source, { force: true })
      // Per-user source not configured - retry as a global source. This is safe today because
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

  // GET /api/library/unreconciled - rows where mbid IS NULL for current user + global
  app.get('/api/library/unreconciled', async (c) => {
    const auth = await adminGate(c)
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
    const auth = await adminGate(c)
    if (!auth.ok) return auth.response
    const items = await deps.librarySyncStore.listUnreconciledAlbumsForUser(auth.userId)
    return c.json({ items })
  })

  // POST /api/library/overrides - create/update an MBID override
  app.post('/api/library/overrides', zJson(libraryOverrideSchema), async (c) => {
    const auth = await adminGate(c)
    if (!auth.ok) return auth.response
    const { source, sourceArtistId, correctMbid, note } = c.req.valid('json')
    const mbid = !correctMbid ? null : correctMbid
    await deps.librarySyncStore.upsertOverride(auth.userId, source, sourceArtistId, mbid, note)
    return c.json({ ok: true })
  })

  app.post('/api/library/album-overrides', zJson(libraryAlbumOverrideSchema), async (c) => {
    const auth = await adminGate(c)
    if (!auth.ok) return auth.response
    const { source, sourceAlbumId, correctAlbumMbid, note } = c.req.valid('json')
    const albumMbid = !correctAlbumMbid ? null : correctAlbumMbid
    await deps.librarySyncStore.upsertAlbumOverride(
      auth.userId,
      source,
      sourceAlbumId,
      albumMbid,
      note,
    )
    return c.json({ ok: true })
  })

  // DELETE /api/library/overrides/:source/:sourceArtistId - remove an override
  app.delete('/api/library/overrides/:source/:sourceArtistId', async (c) => {
    const auth = await adminGate(c)
    if (!auth.ok) return auth.response
    const source = c.req.param('source')
    const sourceArtistId = c.req.param('sourceArtistId')
    await deps.librarySyncStore.deleteOverride(auth.userId, source, sourceArtistId)
    return c.json({ ok: true })
  })

  // POST /api/library/reconcile - re-run reconciler for current user (forced syncForUser)
  // Note: a "reconcile only without re-fetch" path is a follow-up task.
  app.post('/api/library/reconcile', async (c) => {
    const auth = await adminGate(c)
    if (!auth.ok) return auth.response
    deps.librarySync.syncForUser(auth.userId, { force: true }).catch((err: unknown) => {
      console.error('[library/reconcile] sync error:', errMsg(err))
    })
    return c.json({ ok: true }, 202)
  })

  return app
}
