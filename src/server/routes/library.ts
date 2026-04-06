import { Hono } from 'hono'
import type { LibraryHealthService } from '@/core/library/health'
import type { SkyHookWarmer } from '@/core/library/skyhook-warmer'
import type { LibrarySyncStore } from '@/core/library/store'
import type { SyncOrchestrator } from '@/core/library/sync'
import type { HealthCheckId } from '@/core/library/types'
import { errMsg } from '@/core/validation'
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

type LibraryRouteDeps = {
  libraryHealth: LibraryHealthService
  skyhookWarmer?: SkyHookWarmer | null
  librarySync: SyncOrchestrator
  librarySyncStore: LibrarySyncStore
}

export function libraryRoutes(deps: LibraryRouteDeps) {
  const app = new Hono<HonoEnv>()

  // GET /api/library/health -- return cached results + scanning status
  app.get('/api/library/health', (c) => {
    const checks = deps.libraryHealth.getLastResults() ?? []
    return c.json({ checks, scanning: deps.libraryHealth.scanning })
  })

  // POST /api/library/health/scan -- kick off background scan, return 202
  app.post('/api/library/health/scan', (c) => {
    deps.libraryHealth.startScan()
    return c.json({ scanning: true }, 202)
  })

  // POST /api/library/health/:checkId/fix -- trigger fix for a check
  app.post('/api/library/health/:checkId/fix', async (c) => {
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
    const stats = await deps.libraryHealth.getStats()
    return c.json(stats)
  })

  // POST /api/library/warm -- trigger background warming for a batch of MBIDs
  app.post('/api/library/warm', async (c) => {
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
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Auth required' }, 401)
    const sources = await deps.librarySyncStore.listSyncStateForUser(userId)
    return c.json({ sources })
  })

  // POST /api/library/sync -- manual "Sync now", rate-limited 5/min
  app.use('/api/library/sync', rateLimiter({ windowMs: 60_000, max: 5, keyPrefix: 'libsync' }))
  app.post('/api/library/sync', async (c) => {
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Auth required' }, 401)
    const body = await c.req.json().catch(() => ({}))
    const source = typeof body.source === 'string' ? body.source : undefined
    if (source) {
      let result = await deps.librarySync.syncSpecificSource(userId, source, { force: true })
      if (result.status === 'failed' && result.error.includes('not configured')) {
        // Retry as global source
        result = await deps.librarySync.syncSpecificSource(null, source, { force: true })
      }
      deps.librarySync.syncGlobal({ force: true }).catch((err: unknown) => {
        console.error('[library/sync] global sync error:', errMsg(err))
      })
    } else {
      deps.librarySync.syncForUser(userId, { force: true }).catch((err: unknown) => {
        console.error('[library/sync] per-user sync error:', errMsg(err))
      })
      deps.librarySync.syncGlobal({ force: true }).catch((err: unknown) => {
        console.error('[library/sync] global sync error:', errMsg(err))
      })
    }
    return c.json({ ok: true }, 202)
  })

  // GET /api/library/unreconciled -- rows where mbid IS NULL for current user + global
  app.get('/api/library/unreconciled', async (c) => {
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Auth required' }, 401)
    const items = await deps.librarySyncStore.listUnreconciledForUser(userId)
    return c.json({ items })
  })

  // POST /api/library/overrides -- create/update an MBID override
  app.post('/api/library/overrides', async (c) => {
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Auth required' }, 401)
    const body = await c.req.json().catch(() => ({}))
    const { source, sourceArtistId, correctMbid, note } = body as Record<string, unknown>
    if (typeof source !== 'string' || !source) {
      return c.json({ error: 'source is required' }, 400)
    }
    if (typeof sourceArtistId !== 'string' || !sourceArtistId) {
      return c.json({ error: 'sourceArtistId is required' }, 400)
    }
    const mbid = correctMbid === '' || correctMbid == null ? null : (correctMbid as string)
    await deps.librarySyncStore.upsertOverride(
      userId,
      source,
      sourceArtistId,
      mbid,
      typeof note === 'string' ? note : undefined,
    )
    return c.json({ ok: true })
  })

  // DELETE /api/library/overrides/:source/:sourceArtistId -- remove an override
  app.delete('/api/library/overrides/:source/:sourceArtistId', async (c) => {
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Auth required' }, 401)
    const source = c.req.param('source')
    const sourceArtistId = c.req.param('sourceArtistId')
    await deps.librarySyncStore.deleteOverride(userId, source, sourceArtistId)
    return c.json({ ok: true })
  })

  // POST /api/library/reconcile -- re-run reconciler for current user (forced syncForUser)
  // Note: a "reconcile only without re-fetch" path is a follow-up task.
  app.post('/api/library/reconcile', async (c) => {
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Auth required' }, 401)
    deps.librarySync.syncForUser(userId, { force: true }).catch((err: unknown) => {
      console.error('[library/reconcile] sync error:', errMsg(err))
    })
    return c.json({ ok: true }, 202)
  })

  return app
}
