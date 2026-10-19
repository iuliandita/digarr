import { Hono } from 'hono'
import type { AlbumCoverage } from '@/core/library/album-coverage'
import type { LibraryHealthService } from '@/core/library/health'
import type { SkyHookWarmer } from '@/core/library/skyhook-warmer'
import type { LibrarySyncStore } from '@/core/library/store'
import { SOURCE_NOT_CONFIGURED_ERROR, type SyncOrchestrator } from '@/core/library/sync'
import type { HealthCheckId, UnreconciledReason } from '@/core/library/types'
import { errMsg, isValidMbid, logAndSanitize } from '@/core/validation'
import { parseIntClamp } from '@/server/helpers/parse-int-clamp'
import { problem } from '@/server/helpers/problem'
import { requireAdmin, requireSessionUser } from '@/server/helpers/require-user'
import { rateLimiter } from '@/server/middleware/rate-limit'
import {
  libraryAlbumBulkIgnoreSchema,
  libraryAlbumOverrideSchema,
  libraryBulkIgnoreSchema,
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
  'missing-wikidata',
])
type PublicUnreconciledReason = Exclude<UnreconciledReason, 'override_skip'> | null

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

function hideInternalUnreconciledReasons<
  T extends { unreconciledReason: UnreconciledReason | null },
>(
  items: T[],
): Array<Omit<T, 'unreconciledReason'> & { unreconciledReason: PublicUnreconciledReason }> {
  return items.map(({ unreconciledReason, ...item }) => ({
    ...item,
    unreconciledReason: unreconciledReason === 'override_skip' ? null : unreconciledReason,
  }))
}

export function libraryRoutes(deps: LibraryRouteDeps) {
  const app = new Hono<HonoEnv>()

  const adminGate = (c: Parameters<typeof requireAdmin>[0]) => requireAdmin(c, deps.getUserById)

  // GET /api/v1/library/health - return cached results + scanning status
  app.get('/api/v1/library/health', async (c) => {
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

  // POST /api/v1/library/health/scan - kick off background scan, return 202
  app.post('/api/v1/library/health/scan', async (c) => {
    const auth = await adminGate(c)
    if (!auth.ok) return auth.response
    deps.libraryHealth.startScan()
    return c.json({ scanning: true }, 202)
  })

  // POST /api/v1/library/health/:checkId/fix - trigger fix for a check
  app.post('/api/v1/library/health/:checkId/fix', async (c) => {
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
      return c.json({ error: logAndSanitize(err, 'library-health-fix') }, 400)
    }
  })

  // GET /api/v1/library/stats - library statistics
  app.get('/api/v1/library/stats', async (c) => {
    const auth = await adminGate(c)
    if (!auth.ok) return auth.response
    const stats = await deps.libraryHealth.getStats()
    return c.json(stats)
  })

  // POST /api/v1/library/warm - trigger background warming for a batch of MBIDs
  app.post('/api/v1/library/warm', zJson(libraryWarmSchema), async (c) => {
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

  // GET /api/v1/library/warm/status - check warm status for MBIDs
  app.get('/api/v1/library/warm/status', async (c) => {
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

  // GET /api/v1/library/sources - per-source sync state for current user + global rows
  app.get('/api/v1/library/sources', async (c) => {
    const auth = requireSessionUser(c)
    if (!auth.ok) return auth.response
    const sources = await deps.librarySyncStore.listSyncStateForUser(auth.userId)
    return c.json({ sources })
  })

  // POST /api/v1/library/sync - manual "Sync now", rate-limited 5/min
  app.use('/api/v1/library/sync', rateLimiter({ windowMs: 60_000, max: 5, keyPrefix: 'libsync' }))
  // Sync-all has no single in-flight key, so the route tracks it to reject a second click.
  let syncAllRunning = false
  app.post('/api/v1/library/sync', zJson(librarySyncSchema), async (c) => {
    const auth = await adminGate(c)
    if (!auth.ok) return auth.response
    const { source } = c.req.valid('json')
    const alreadyRunning = () =>
      problem(
        c,
        'library-sync-already-running',
        'A library sync is already in progress',
        409,
        undefined,
        undefined,
        'errors.library.syncAlreadyRunning',
      )
    // A Lidarr sync can run for minutes, longer than reverse-proxy timeouts, so run it detached.
    // Progress and failures land in library_sync_state and Job History.
    const runDetached = (label: string, run: () => Promise<unknown>, done?: () => void) => {
      run()
        .catch((err: unknown) => {
          console.error(`[library/sync] ${label} error:`, errMsg(err))
        })
        .finally(done)
    }

    if (source) {
      // Per-user source first, then global. A source configured in neither is reported now.
      const scope = await deps.librarySync.resolveSourceScope(auth.userId, source)
      if (!scope) {
        return problem(
          c,
          'library-source-not-configured',
          `Source '${source}' ${SOURCE_NOT_CONFIGURED_ERROR}`,
          404,
        )
      }
      if (deps.librarySync.isRunning(scope.userId, source)) return alreadyRunning()
      runDetached(source, () =>
        deps.librarySync.syncSpecificSource(scope.userId, source, { force: true }),
      )
      return c.json({ source, status: 'started' as const }, 202)
    }

    if (syncAllRunning) return alreadyRunning()
    syncAllRunning = true
    runDetached(
      'all',
      async () => {
        await deps.librarySync.syncGlobal({ force: true })
        await deps.librarySync.syncForUser(auth.userId, { force: true })
      },
      () => {
        syncAllRunning = false
      },
    )
    return c.json({ status: 'started' as const }, 202)
  })

  // GET /api/v1/library/unreconciled - rows where mbid IS NULL for current user + global
  app.get('/api/v1/library/unreconciled', async (c) => {
    const auth = await adminGate(c)
    if (!auth.ok) return auth.response
    const page = {
      limit: parseIntClamp(c.req.query('limit'), { name: 'limit', min: 1, max: 500, default: 20 }),
      offset: parseIntClamp(c.req.query('offset'), {
        name: 'offset',
        min: 0,
        max: Number.MAX_SAFE_INTEGER,
        default: 0,
      }),
    }
    const result = await deps.librarySyncStore.listUnreconciledForUser(auth.userId, page)
    return c.json({ ...result, items: hideInternalUnreconciledReasons(result.items) })
  })

  app.get('/api/v1/library/album-coverage/:artistMbid', async (c) => {
    const auth = requireSessionUser(c)
    if (!auth.ok) return auth.response
    const artistMbid = c.req.param('artistMbid')
    if (!isValidMbid(artistMbid)) {
      return c.json({ error: 'artistMbid must be a valid UUID' }, 400)
    }
    const coverage = await deps.albumCoverage.getCoverageForArtist(auth.userId, artistMbid)
    return c.json(coverage)
  })

  app.get('/api/v1/library/unreconciled-albums', async (c) => {
    const auth = await adminGate(c)
    if (!auth.ok) return auth.response
    const page = {
      limit: parseIntClamp(c.req.query('limit'), { name: 'limit', min: 1, max: 500, default: 20 }),
      offset: parseIntClamp(c.req.query('offset'), {
        name: 'offset',
        min: 0,
        max: Number.MAX_SAFE_INTEGER,
        default: 0,
      }),
    }
    const result = await deps.librarySyncStore.listUnreconciledAlbumsForUser(auth.userId, page)
    return c.json({ ...result, items: hideInternalUnreconciledReasons(result.items) })
  })

  app.post('/api/v1/library/overrides/bulk-ignore', zJson(libraryBulkIgnoreSchema), async (c) => {
    const auth = await adminGate(c)
    if (!auth.ok) return auth.response
    const { items } = c.req.valid('json')
    await deps.librarySyncStore.bulkIgnoreArtists(auth.userId, items)
    return c.body(null, 204)
  })

  // POST /api/v1/library/overrides - create/update an MBID override
  app.post('/api/v1/library/overrides', zJson(libraryOverrideSchema), async (c) => {
    const auth = await adminGate(c)
    if (!auth.ok) return auth.response
    const { source, sourceArtistId, correctMbid, note } = c.req.valid('json')
    const mbid = !correctMbid ? null : correctMbid
    await deps.librarySyncStore.upsertOverride(auth.userId, source, sourceArtistId, mbid, note)
    return c.body(null, 204)
  })

  app.post(
    '/api/v1/library/album-overrides/bulk-ignore',
    zJson(libraryAlbumBulkIgnoreSchema),
    async (c) => {
      const auth = await adminGate(c)
      if (!auth.ok) return auth.response
      const { items } = c.req.valid('json')
      await deps.librarySyncStore.bulkIgnoreAlbums(auth.userId, items)
      return c.body(null, 204)
    },
  )

  app.post('/api/v1/library/album-overrides', zJson(libraryAlbumOverrideSchema), async (c) => {
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
    return c.body(null, 204)
  })

  // DELETE /api/v1/library/overrides/:source/:sourceArtistId - remove an override
  app.delete('/api/v1/library/overrides/:source/:sourceArtistId', async (c) => {
    const auth = await adminGate(c)
    if (!auth.ok) return auth.response
    const source = c.req.param('source')
    const sourceArtistId = c.req.param('sourceArtistId')
    await deps.librarySyncStore.deleteOverride(auth.userId, source, sourceArtistId)
    return c.body(null, 204)
  })

  // POST /api/v1/library/reconcile - re-run reconciler for current user (forced syncForUser)
  // Note: a "reconcile only without re-fetch" path is a follow-up task.
  app.post('/api/v1/library/reconcile', async (c) => {
    const auth = await adminGate(c)
    if (!auth.ok) return auth.response
    deps.librarySync.syncForUser(auth.userId, { force: true }).catch((err: unknown) => {
      console.error('[library/reconcile] sync error:', errMsg(err))
    })
    return c.body(null, 202)
  })

  return app
}
