// @vitest-environment node

import { EventEmitter } from 'node:events'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAllSessions, createSession } from '@/core/sessions'
import type { SettingsRow } from '@/db/queries/settings'
import type { AppDependencies } from '@/server'
import { createApp } from '@/server'
import type { HonoEnv } from '@/server/types'

vi.mock('@/core/clients/lidarr', () => ({
  createLidarrClient: vi.fn(),
}))

import { createLidarrClient } from '@/core/clients/lidarr'

function makeMockOrchestrator() {
  const emitter = new EventEmitter()
  return Object.assign(emitter, {
    isRunning: false,
    run: vi.fn(async () => ({ batchId: 1 })),
  })
}

const mockChecks = [
  {
    id: 'missing-metadata',
    name: 'Missing Metadata',
    description: 'Artists in Lidarr with no genres and no image in local cache.',
    severity: 'warning',
    count: 0,
    items: [],
    fixable: true,
  },
]

const mockStats = {
  totalArtists: 10,
  totalAlbums: 0,
  monitoredArtists: 8,
  genreDistribution: [{ genre: 'Rock', count: 5 }],
  rootFolders: [{ path: '/music', freeSpace: 1000000 }],
}

const mockFixProgress = {
  checkId: 'unmonitored',
  total: 2,
  completed: 2,
  failed: 0,
  status: 'completed',
  errors: [],
}

function makeMockLibraryHealth(opts: { hasCached?: boolean; scanning?: boolean } = {}) {
  return {
    getLastResults: vi.fn(() => (opts.hasCached ? mockChecks : null)),
    runChecks: vi.fn(async () => mockChecks),
    startScan: vi.fn(),
    scanning: opts.scanning ?? false,
    fixCheck: vi.fn(async () => mockFixProgress),
    getStats: vi.fn(async () => mockStats),
  }
}

function zeroCounts() {
  return {
    total: 0,
    matchedMbid: 0,
    matchedNameExact: 0,
    matchedNameAnchored: 0,
    matchedDisambiguated: 0,
    unreconciledAmbiguous: 0,
    unreconciledNoCandidate: 0,
    cacheHits: 0,
    mbApiCalls: 0,
  }
}

function makeMockLibrarySync() {
  return {
    syncGlobal: vi.fn(async () => ({ userId: null, results: [] })),
    syncForUser: vi.fn(async () => ({ userId: 1, results: [] })),
    syncSpecificSource: vi.fn(async () => ({
      source: 'plex',
      status: 'completed' as const,
      counts: zeroCounts(),
    })),
  }
}

function makeMockLibrarySyncStore() {
  return {
    replaceLibrarySnapshot: vi.fn(async () => zeroCounts()),
    replaceLibraryArtists: vi.fn(async () => zeroCounts()),
    findReconciledByNormalizedName: vi.fn(async () => []),
    getLibrarySyncState: vi.fn(async () => null),
    upsertLibrarySyncState: vi.fn(async () => {}),
    clearRunningSyncStates: vi.fn(async () => 0),
    getOverride: vi.fn(async () => null),
    getAllOverrides: vi.fn(async () => new Map()),
    upsertOverride: vi.fn(async () => {}),
    deleteOverride: vi.fn(async () => {}),
    getKnownMbidsForUser: vi.fn(async () => new Set<string>()),
    userHasAnySyncState: vi.fn(async () => false),
    listSyncStateForUser: vi.fn(async () => []),
    listUnreconciledForUser: vi.fn(async () => []),
    listUnreconciledAlbumsForUser: vi.fn(async () => []),
    listOwnedAlbumsForArtist: vi.fn(async () => []),
    upsertAlbumOverride: vi.fn(async () => {}),
  }
}

function makeDeps(overrides: Partial<AppDependencies> = {}): AppDependencies {
  return {
    db: { execute: vi.fn(async () => []) } as unknown as AppDependencies['db'],
    storeDb: {} as unknown as AppDependencies['storeDb'],
    orchestrator: makeMockOrchestrator() as unknown as AppDependencies['orchestrator'],
    scheduler: {} as AppDependencies['scheduler'],
    providerRegistry: {} as unknown as AppDependencies['providerRegistry'],
    isSetupComplete: async () => true,
    getSettings: vi.fn(
      async () =>
        ({
          id: 1,
          lidarrUrl: 'http://lidarr:8686',
          lidarrApiKey: 'key',
          preferences: { qualityProfileId: 1, rootFolderId: 1 },
        }) as SettingsRow,
    ),
    updateSettings: vi.fn(async () => {}),
    completeSetup: vi.fn(async () => ({ id: 1, setupComplete: true })),
    getLastBatch: vi.fn(async () => null),
    listRecommendations: vi.fn(async () => ({ items: [], total: 0 })),
    getRecommendation: vi.fn(async () => null),
    updateRecommendationStatus: vi.fn(async () => {}),
    bulkUpdateStatus: vi.fn(async () => {}),
    filterOwnedIds: vi.fn(async (ids: number[]) => ids),
    listBatches: vi.fn(async () => []),
    getBatch: vi.fn(async () => null),
    getArtistById: vi.fn(async () => null),
    restartScheduler: vi.fn(),
    restartPlaylistScheduler: vi.fn(),
    createUser: vi.fn(async () => ({
      id: 1,
      username: 'test',
      isAdmin: false,
      preferences: null,
      email: null,
      oidcSubject: null,
      authProvider: 'local',
      listenbrainzUsername: null,
      listenbrainzToken: null,
      lastfmUsername: null,
      lastfmApiKey: null,
      plexUrl: null,
      plexToken: null,
      jellyfinUrl: null,
      jellyfinApiKey: null,
      jellyfinUserId: null,
      embyUrl: null,
      embyApiKey: null,
      embyUserId: null,
      discogsToken: null,
      discogsUsername: null,
      createdAt: new Date(),
    })),
    getUserByUsername: vi.fn(async () => null),
    getUserById: vi.fn(async () => null),
    getUserCount: vi.fn(async () => 0),
    updatePassword: vi.fn(async () => {}),
    genreService: {} as unknown as AppDependencies['genreService'],
    libraryHealth: makeMockLibraryHealth() as unknown as AppDependencies['libraryHealth'],
    targetQueries: {
      createTarget: vi.fn().mockResolvedValue({ id: 1 }),
      getTargetsByUser: vi.fn().mockResolvedValue([]),
      getAllTargets: vi.fn().mockResolvedValue([]),
      getTarget: vi.fn().mockResolvedValue(null),
      updateTarget: vi.fn().mockResolvedValue(undefined),
      deleteTarget: vi.fn().mockResolvedValue(undefined),
    },
    testTargetConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
    getEnabledTargetsForUser: vi.fn().mockResolvedValue([]),
    subscriptionQueries: {
      createSubscription: vi.fn(async () => ({}) as never),
      getSubscription: vi.fn(async () => null),
      getSubscriptionsByUser: vi.fn(async () => []),
      getEnabledSubscriptions: vi.fn(async () => []),
      updateSubscription: vi.fn(async () => {}),
      deleteSubscription: vi.fn(async () => {}),
    },
    runSubscription: vi.fn(async () => {}),
    getOidcService: vi.fn(async () => null),
    getUserByOidcSubject: vi.fn(async () => null),
    getUserByEmail: vi.fn(async () => null),
    updateUser: vi.fn(async () => {}),
    listUsers: vi.fn(async () => []),
    deleteUser: vi.fn(async () => {}),
    getFeedbackHistory: vi.fn(async () => new Map()),
    dashboardQueries: {
      getTopGenresForUser: vi.fn(async () => []),
      getRecentActivity: vi.fn(async () => []),
    },
    jobRecorder: {
      start: vi.fn().mockResolvedValue(1),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn().mockResolvedValue(undefined),
      markStuck: vi.fn().mockResolvedValue(0),
    },
    jobQueries: {
      listJobs: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      getJobById: vi.fn().mockResolvedValue(null),
      getJobHealth: vi.fn().mockResolvedValue({
        pipeline: { status: 'ok', lastRun: null, nextRun: null },
        subscriptions: { status: 'ok', healthy: 0, total: 0 },
        playlists: { status: 'ok', lastRun: null },
        sources: {},
      }),
      getJobsForSubscription: vi.fn().mockResolvedValue([]),
    },
    librarySync: makeMockLibrarySync() as unknown as AppDependencies['librarySync'],
    librarySyncStore: makeMockLibrarySyncStore() as unknown as AppDependencies['librarySyncStore'],
    albumCoverage: {
      getCoverageForArtist: vi.fn(async () => ({
        artistMbid: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
        ownedCount: 0,
        totalCount: 0,
        owned: [],
        missing: [],
      })),
    } as unknown as AppDependencies['albumCoverage'],
    ...overrides,
  }
}

const mockLidarrClient = {
  addArtist: vi.fn(),
  getQualityProfiles: vi.fn(async () => []),
  getMetadataProfiles: vi.fn(async () => []),
  getRootFolders: vi.fn(async () => []),
  getArtists: vi.fn(async () => []),
  lookupArtist: vi.fn(async () => []),
  getAlbums: vi.fn(async () => []),
  updateArtist: vi.fn(async () => ({
    id: 0,
    artistName: '',
    foreignArtistId: '',
    qualityProfileId: 0,
    rootFolderPath: '',
    monitored: false,
    status: '',
  })),
  updateAlbum: vi.fn(async () => ({
    id: 0,
    title: '',
    artistId: 0,
    foreignAlbumId: '',
    monitored: false,
    albumType: '',
  })),
  triggerCommand: vi.fn(async () => ({ id: 0, name: '', status: '' })),
  testConnection: vi.fn(async () => ({ success: true, message: 'ok' })),
}

beforeEach(() => {
  vi.mocked(createLidarrClient).mockReturnValue(
    mockLidarrClient as ReturnType<typeof createLidarrClient>,
  )
  vi.clearAllMocks()
  vi.mocked(createLidarrClient).mockReturnValue(
    mockLidarrClient as ReturnType<typeof createLidarrClient>,
  )
})

afterEach(async () => {
  delete process.env.DIGARR_AUTH_TOKEN
  await clearAllSessions()
})

async function createMountedAppWithLegacyToken(
  token: string,
  overrides: Partial<AppDependencies> = {},
) {
  vi.resetModules()
  process.env.DIGARR_AUTH_TOKEN = token
  const { createApp: createMountedApp } = await import('@/server')
  return createMountedApp(makeDeps(overrides))
}

describe('GET /api/library/health', () => {
  it('returns cached results and scanning status', async () => {
    const libraryHealth = makeMockLibraryHealth({
      hasCached: true,
    }) as unknown as AppDependencies['libraryHealth']
    const app = createApp(makeDeps({ libraryHealth }))
    const res = await app.request('/api/library/health')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.scanning).toBe(false)
    expect(body.checks).toHaveLength(1)
    expect(body.checks[0].id).toBe('missing-metadata')
  })

  it('returns empty checks when no cache', async () => {
    const libraryHealth = makeMockLibraryHealth({
      hasCached: false,
    }) as unknown as AppDependencies['libraryHealth']
    const app = createApp(makeDeps({ libraryHealth }))
    const res = await app.request('/api/library/health')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.scanning).toBe(false)
    expect(body.checks).toHaveLength(0)
  })
})

describe('POST /api/library/health/scan', () => {
  it('starts a background scan and returns 202', async () => {
    const libraryHealth = makeMockLibraryHealth({
      hasCached: true,
    }) as unknown as AppDependencies['libraryHealth']
    const app = createApp(makeDeps({ libraryHealth }))
    const res = await app.request('/api/library/health/scan', { method: 'POST' })
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.scanning).toBe(true)
    expect((libraryHealth.startScan as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1)
  })
})

describe('POST /api/library/health/:checkId/fix', () => {
  it('triggers fix for a valid check ID', async () => {
    const libraryHealth = makeMockLibraryHealth() as unknown as AppDependencies['libraryHealth']
    const app = createApp(makeDeps({ libraryHealth }))
    const res = await app.request('/api/library/health/unmonitored/fix', { method: 'POST' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.checkId).toBe('unmonitored')
    expect(body.status).toBe('completed')
    const fixCalls = (libraryHealth.fixCheck as ReturnType<typeof vi.fn>).mock.calls
    expect(fixCalls).toHaveLength(1)
    expect(fixCalls[0]?.[0]).toBe('unmonitored')
  })

  it('returns 400 for invalid check ID', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/library/health/totally-bogus/fix', { method: 'POST' })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Invalid check ID')
  })

  it('returns 400 when fixCheck throws', async () => {
    const libraryHealth = {
      ...makeMockLibraryHealth(),
      fixCheck: vi.fn(async () => {
        throw new Error('duplicate-artists check is not fixable')
      }),
    } as unknown as AppDependencies['libraryHealth']
    const app = createApp(makeDeps({ libraryHealth }))
    const res = await app.request('/api/library/health/duplicate-artists/fix', { method: 'POST' })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/not fixable/i)
  })
})

describe('GET /api/library/stats', () => {
  it('returns library statistics', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/library/stats')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.totalArtists).toBe(10)
    expect(body.monitoredArtists).toBe(8)
    expect(body.genreDistribution).toHaveLength(1)
    expect(body.rootFolders).toHaveLength(1)
  })
})

function makeMockWarmer() {
  return {
    warmInBackground: vi.fn(),
    getStatus: vi.fn((mbid: string) => (mbid === 'mbid-1' ? 'warm' : 'unknown')),
    isWarm: vi.fn(),
    warm: vi.fn(),
    warmBatch: vi.fn(),
  }
}

describe('POST /api/library/warm', () => {
  it('queues background warming and returns 202', async () => {
    const mockWarmer = makeMockWarmer()
    const app = createApp(
      makeDeps({ skyhookWarmer: mockWarmer as unknown as AppDependencies['skyhookWarmer'] }),
    )
    const res = await app.request('/api/library/warm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mbids: ['mbid-1', 'mbid-2'] }),
    })
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.queued).toBe(2)
    const warmCalls = mockWarmer.warmInBackground.mock.calls
    expect(warmCalls).toHaveLength(2)
    expect(warmCalls[0]?.[0]).toBe('mbid-1')
    expect(warmCalls[1]?.[0]).toBe('mbid-2')
  })

  it('returns 400 when warmer not available', async () => {
    const app = createApp(makeDeps({ skyhookWarmer: null }))
    const res = await app.request('/api/library/warm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mbids: ['mbid-1'] }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/not available/i)
  })

  it('returns 400 for missing mbids', async () => {
    const skyhookWarmer = makeMockWarmer() as unknown as AppDependencies['skyhookWarmer']
    const app = createApp(makeDeps({ skyhookWarmer }))
    const res = await app.request('/api/library/warm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/mbids array required/i)
  })

  it('returns 400 for empty mbids array', async () => {
    const skyhookWarmer = makeMockWarmer() as unknown as AppDependencies['skyhookWarmer']
    const app = createApp(makeDeps({ skyhookWarmer }))
    const res = await app.request('/api/library/warm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mbids: [] }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/mbids array required/i)
  })

  it('limits batch to 50 MBIDs', async () => {
    const mockWarmer = makeMockWarmer()
    const app = createApp(
      makeDeps({ skyhookWarmer: mockWarmer as unknown as AppDependencies['skyhookWarmer'] }),
    )
    const mbids = Array.from({ length: 60 }, (_, i) => `mbid-${i}`)
    const res = await app.request('/api/library/warm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mbids }),
    })
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.queued).toBe(50)
    expect(mockWarmer.warmInBackground.mock.calls).toHaveLength(50)
  })
})

describe('GET /api/library/warm/status', () => {
  it('returns statuses for requested MBIDs', async () => {
    const skyhookWarmer = makeMockWarmer() as unknown as AppDependencies['skyhookWarmer']
    const app = createApp(makeDeps({ skyhookWarmer }))
    const res = await app.request('/api/library/warm/status?mbids=mbid-1,mbid-2')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.statuses['mbid-1']).toBe('warm')
    expect(body.statuses['mbid-2']).toBe('unknown')
  })

  it('returns empty statuses object when warmer not available', async () => {
    const app = createApp(makeDeps({ skyhookWarmer: null }))
    const res = await app.request('/api/library/warm/status?mbids=mbid-1')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.statuses).toEqual({})
  })

  it('returns empty statuses when no mbids param', async () => {
    const skyhookWarmer = makeMockWarmer() as unknown as AppDependencies['skyhookWarmer']
    const app = createApp(makeDeps({ skyhookWarmer }))
    const res = await app.request('/api/library/warm/status')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.statuses).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// New sync/sources/unreconciled/overrides/reconcile routes
//
// These handlers require userId to be set on the context. Rather than fighting
// the authSkipped+userId gap in the full createApp path, we mount libraryRoutes
// directly with a tiny middleware that sets userId -- same pattern as jobs.test.ts.
// ---------------------------------------------------------------------------

import { libraryRoutes } from '@/server/routes/library'

type SyncAppOptions = {
  authSkipped?: boolean
  userId?: number
  isAdmin?: boolean
  getUserById?: AppDependencies['getUserById']
  albumCoverageOverride?: {
    getCoverageForArtist: (userId: number, artistMbid: string) => Promise<unknown>
  }
}

function makeSyncApp(
  librarySyncOverride?: Record<string, unknown>,
  librarySyncStoreOverride?: Record<string, unknown>,
  options: SyncAppOptions = {},
) {
  const librarySync = {
    ...makeMockLibrarySync(),
    ...librarySyncOverride,
  } as unknown as AppDependencies['librarySync']
  const librarySyncStore = {
    ...makeMockLibrarySyncStore(),
    ...librarySyncStoreOverride,
  } as unknown as AppDependencies['librarySyncStore']
  const albumCoverage = options.albumCoverageOverride ?? {
    getCoverageForArtist: vi.fn(async (userId: number, artistMbid: string) => ({
      artistMbid,
      ownedCount: 0,
      totalCount: 0,
      owned: [],
      missing: [],
      userId,
    })),
  }
  const getUserById =
    options.getUserById ??
    (vi.fn(async () => ({
      isAdmin: options.isAdmin ?? true,
    })) as unknown as AppDependencies['getUserById'])
  const routeDeps = {
    libraryHealth: makeMockLibraryHealth() as unknown as AppDependencies['libraryHealth'],
    skyhookWarmer: null,
    librarySync,
    librarySyncStore,
    albumCoverage,
    getUserById,
  } as Parameters<typeof libraryRoutes>[0] & {
    albumCoverage: typeof albumCoverage
    getUserById: AppDependencies['getUserById']
  }
  const app = new Hono<HonoEnv>()
  app.use('*', async (c, next) => {
    c.set('authSkipped', options.authSkipped ?? false)
    if (options.userId !== undefined ? options.userId : 42) {
      c.set('userId', options.userId ?? 42)
    }
    return next()
  })
  app.route('/', libraryRoutes(routeDeps))
  return { app, librarySync, librarySyncStore, albumCoverage, getUserById }
}

describe('GET /api/library/sources', () => {
  it('returns sync state rows for the authed user', async () => {
    const mockRows = [
      {
        userId: 42,
        source: 'plex',
        lastSyncStartedAt: null,
        lastSyncCompletedAt: null,
        lastSyncStatus: 'completed',
        lastSyncError: null,
        lastSyncCounts: null,
      },
      {
        userId: null,
        source: 'lidarr',
        lastSyncStartedAt: null,
        lastSyncCompletedAt: null,
        lastSyncStatus: null,
        lastSyncError: null,
        lastSyncCounts: null,
      },
    ]
    const { app, librarySyncStore } = makeSyncApp(undefined, {
      listSyncStateForUser: vi.fn(async () => mockRows),
    })
    const res = await app.request('/api/library/sources')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sources).toHaveLength(2)
    expect(body.sources[0].source).toBe('plex')
    expect(body.sources[1].source).toBe('lidarr')
    expect(
      (librarySyncStore.listSyncStateForUser as ReturnType<typeof vi.fn>).mock.calls[0]?.[0],
    ).toBe(42)
  })
})

describe('POST /api/library/sync', () => {
  it('POST /api/library/sync runs global before user sync and returns the user summary', async () => {
    const order: string[] = []
    let resolved = false
    const syncForUser = vi.fn(async () => {
      order.push('user')
      await new Promise((r) => setTimeout(r, 10))
      resolved = true
      return { userId: 1, results: [] }
    })
    const syncGlobal = vi.fn(async () => {
      order.push('global')
      return { userId: null, results: [] }
    })
    const { app } = makeSyncApp({ syncForUser, syncGlobal })

    const res = await app.request('/api/library/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(resolved).toBe(true) // proves the route awaited
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.userId).toBe(1)
    expect(body.results).toEqual([])
    expect(order).toEqual(['global', 'user'])
    expect(syncForUser).toHaveBeenCalledWith(42, { force: true })
    expect(syncGlobal).toHaveBeenCalledWith({ force: true })
  })

  it('fires syncSpecificSource when source provided', async () => {
    const { app, librarySync } = makeSyncApp()
    const res = await app.request('/api/library/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'plex' }),
    })
    expect(res.status).toBe(200)
    expect(librarySync.syncSpecificSource as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      42,
      'plex',
      { force: true },
    )
  })

  it('retries syncSpecificSource with userId=null when source not configured', async () => {
    const syncSpecificSource = vi
      .fn()
      .mockResolvedValueOnce({
        source: 'plex',
        status: 'failed',
        error: "Source 'plex' not configured",
      })
      .mockResolvedValueOnce({
        source: 'plex',
        status: 'completed',
        counts: zeroCounts(),
      })
    const { app } = makeSyncApp({ syncSpecificSource })

    const res = await app.request('/api/library/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'plex' }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('completed')
    expect(syncSpecificSource).toHaveBeenCalledTimes(2)
    expect(syncSpecificSource).toHaveBeenNthCalledWith(1, 42, 'plex', { force: true })
    expect(syncSpecificSource).toHaveBeenNthCalledWith(2, null, 'plex', { force: true })
  })

  it('POST /api/library/sync returns 202 (not 500) when body is JSON null', async () => {
    const { app } = makeSyncApp()
    const res = await app.request('/api/library/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'null',
    })
    expect(res.status).toBe(202)
  })

  it('POST /api/library/overrides returns 400 (not 500) when body is JSON null', async () => {
    const { app } = makeSyncApp()
    const res = await app.request('/api/library/overrides', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'null',
    })
    expect(res.status).toBe(400)
  })
})

describe('GET /api/library/unreconciled', () => {
  it('returns unreconciled rows for the authed user', async () => {
    const mockItems = [
      {
        id: 1,
        userId: 42,
        source: 'plex',
        sourceArtistId: 'plex-123',
        name: 'Unknown Artist',
        nameNormalized: 'unknown artist',
        mbid: null,
        matchMethod: null,
        matchConfidence: null,
        genres: null,
        syncedAt: new Date(),
      },
    ]
    const { app, librarySyncStore } = makeSyncApp(undefined, {
      listUnreconciledForUser: vi.fn(async () => mockItems),
    })
    const res = await app.request('/api/library/unreconciled')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toHaveLength(1)
    expect(body.items[0].source).toBe('plex')
    expect(
      (librarySyncStore.listUnreconciledForUser as ReturnType<typeof vi.fn>).mock.calls[0]?.[0],
    ).toBe(42)
  })
})

describe('GET /api/library/album-coverage/:artistMbid', () => {
  it('returns owned and missing studio albums for the current user', async () => {
    const artistMbid = 'a74b1b7f-71a5-4011-9441-d0b5e4122711'
    const coverage = {
      artistMbid,
      ownedCount: 1,
      totalCount: 2,
      owned: [
        {
          albumMbid: '11111111-1111-1111-1111-111111111111',
          title: 'Dummy',
          releaseYear: 1991,
        },
      ],
      missing: [
        {
          albumMbid: '22222222-2222-2222-2222-222222222222',
          title: 'Hex',
          releaseYear: 1994,
        },
      ],
    }
    const { app, albumCoverage } = makeSyncApp(undefined, undefined, {
      albumCoverageOverride: {
        getCoverageForArtist: vi.fn(async () => coverage),
      },
    })

    const res = await app.request(`/api/library/album-coverage/${artistMbid}`)

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual(coverage)
    expect(albumCoverage.getCoverageForArtist).toHaveBeenCalledWith(42, artistMbid)
  })

  it('allows non-admin authenticated users through the real app mount', async () => {
    const token = 'library-session-token'
    const artistMbid = 'a74b1b7f-71a5-4011-9441-d0b5e4122711'
    const coverage = {
      artistMbid,
      ownedCount: 1,
      totalCount: 2,
      owned: [
        {
          albumMbid: '11111111-1111-1111-1111-111111111111',
          title: 'Dummy',
          releaseYear: 1991,
        },
      ],
      missing: [
        {
          albumMbid: '22222222-2222-2222-2222-222222222222',
          title: 'Hex',
          releaseYear: 1994,
        },
      ],
    }
    await createSession(7, token)
    const app = createApp(
      makeDeps({
        getUserCount: vi.fn(async () => 1),
        getUserById: vi.fn(async () => ({
          id: 7,
          username: 'listener',
          isAdmin: false,
        })) as unknown as AppDependencies['getUserById'],
        albumCoverage: {
          getCoverageForArtist: vi.fn(async () => coverage),
        },
      }),
    )

    const res = await app.request(`/api/library/album-coverage/${artistMbid}`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual(coverage)
  })
})

describe('Mounted library admin gating', () => {
  it('blocks non-admin users from library maintenance endpoints in the real app mount', async () => {
    const token = 'library-maintenance-session-token'
    await createSession(9, token)
    const libraryHealth = makeMockLibraryHealth()
    const app = createApp(
      makeDeps({
        getUserCount: vi.fn(async () => 1),
        getUserById: vi.fn(async () => ({
          id: 9,
          username: 'listener',
          isAdmin: false,
        })) as unknown as AppDependencies['getUserById'],
        libraryHealth: libraryHealth as unknown as AppDependencies['libraryHealth'],
      }),
    )

    const res = await app.request('/api/library/health/scan', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(403)
    expect((libraryHealth.startScan as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0)
  })
})

describe('Mounted library legacy-token gating', () => {
  it('rejects legacy-token auth for admin-only library maintenance even when user 1 is admin', async () => {
    const token = 'legacy-library-token'
    const libraryHealth = makeMockLibraryHealth()
    const app = await createMountedAppWithLegacyToken(token, {
      getUserById: vi.fn(async () => ({
        id: 1,
        username: 'admin',
        isAdmin: true,
      })) as unknown as AppDependencies['getUserById'],
      libraryHealth: libraryHealth as unknown as AppDependencies['libraryHealth'],
    })

    const res = await app.request('/api/library/health', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(403)
    expect((libraryHealth.getLastResults as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0)
  })

  it('rejects legacy-token auth for per-user library sources', async () => {
    const token = 'legacy-library-token'
    const app = await createMountedAppWithLegacyToken(token)

    const res = await app.request('/api/library/sources', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ error: 'Session authentication required' })
  })

  it('rejects legacy-token auth for album coverage', async () => {
    const token = 'legacy-library-token'
    const artistMbid = 'a74b1b7f-71a5-4011-9441-d0b5e4122711'
    const app = await createMountedAppWithLegacyToken(token, {
      albumCoverage: {
        getCoverageForArtist: vi.fn(async () => ({
          artistMbid,
          ownedCount: 0,
          totalCount: 0,
          owned: [],
          missing: [],
        })),
      },
    })

    const res = await app.request(`/api/library/album-coverage/${artistMbid}`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ error: 'Session authentication required' })
  })
})

describe('GET /api/library/unreconciled-albums', () => {
  it('returns unreconciled album rows for admins', async () => {
    const mockItems = [
      {
        id: 1,
        userId: 42,
        source: 'plex',
        sourceArtistId: 'artist-1',
        sourceAlbumId: 'album-1',
        title: 'Unknown Album',
        titleNormalized: 'unknown album',
        albumMbid: null,
        artistMbid: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
        primaryType: 'Album',
        releaseYear: 1991,
        syncedAt: new Date(),
      },
    ]
    const { app, librarySyncStore } = makeSyncApp(undefined, {
      listUnreconciledAlbumsForUser: vi.fn(async () => mockItems),
    })

    const res = await app.request('/api/library/unreconciled-albums')

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toHaveLength(1)
    expect(body.items[0].sourceAlbumId).toBe('album-1')
    expect(
      (librarySyncStore.listUnreconciledAlbumsForUser as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0],
    ).toBe(42)
  })
})

describe('POST /api/library/overrides', () => {
  it('calls upsertOverride with correct args and returns ok', async () => {
    const { app, librarySyncStore } = makeSyncApp()
    const res = await app.request('/api/library/overrides', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'plex',
        sourceArtistId: 'plex-123',
        correctMbid: '123e4567-e89b-12d3-a456-426614174000',
        note: 'manual fix',
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(librarySyncStore.upsertOverride as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      42,
      'plex',
      'plex-123',
      '123e4567-e89b-12d3-a456-426614174000',
      'manual fix',
    )
  })

  it('coerces empty string correctMbid to null', async () => {
    const { app, librarySyncStore } = makeSyncApp()
    await app.request('/api/library/overrides', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'plex', sourceArtistId: 'plex-123', correctMbid: '' }),
    })
    expect(librarySyncStore.upsertOverride as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      42,
      'plex',
      'plex-123',
      null,
      undefined,
    )
  })

  it('returns 400 when correctMbid is not a UUID', async () => {
    const { app, librarySyncStore } = makeSyncApp()
    const res = await app.request('/api/library/overrides', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'plex',
        sourceArtistId: 'plex-123',
        correctMbid: 'not-a-uuid',
      }),
    })

    expect(res.status).toBe(400)
    expect(librarySyncStore.upsertOverride as ReturnType<typeof vi.fn>).not.toHaveBeenCalled()
  })

  it('returns 400 when source is missing', async () => {
    const { app } = makeSyncApp()
    const res = await app.request('/api/library/overrides', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceArtistId: 'plex-123' }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/source/i)
  })
})

describe('POST /api/library/album-overrides', () => {
  it('calls upsertAlbumOverride with correct args for admins', async () => {
    const { app, librarySyncStore } = makeSyncApp()
    const res = await app.request('/api/library/album-overrides', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'plex',
        sourceAlbumId: 'album-1',
        correctAlbumMbid: '123e4567-e89b-12d3-a456-426614174000',
        note: 'manual album fix',
      }),
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
    expect(librarySyncStore.upsertAlbumOverride as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      42,
      'plex',
      'album-1',
      '123e4567-e89b-12d3-a456-426614174000',
      'manual album fix',
    )
  })

  it('returns 400 when correctAlbumMbid is not a UUID', async () => {
    const { app, librarySyncStore } = makeSyncApp()
    const res = await app.request('/api/library/album-overrides', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'plex',
        sourceAlbumId: 'album-1',
        correctAlbumMbid: 'not-a-uuid',
      }),
    })

    expect(res.status).toBe(400)
    expect(librarySyncStore.upsertAlbumOverride as ReturnType<typeof vi.fn>).not.toHaveBeenCalled()
  })

  it('returns 400 when sourceAlbumId is missing', async () => {
    const { app, librarySyncStore } = makeSyncApp()
    const res = await app.request('/api/library/album-overrides', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'plex',
        correctAlbumMbid: '123e4567-e89b-12d3-a456-426614174000',
      }),
    })

    expect(res.status).toBe(400)
    expect(librarySyncStore.upsertAlbumOverride as ReturnType<typeof vi.fn>).not.toHaveBeenCalled()
  })

  it('returns 403 for non-admin users', async () => {
    const { app, librarySyncStore } = makeSyncApp(undefined, undefined, { isAdmin: false })
    const res = await app.request('/api/library/album-overrides', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'plex',
        sourceAlbumId: 'album-1',
        correctAlbumMbid: '123e4567-e89b-12d3-a456-426614174000',
      }),
    })

    expect(res.status).toBe(403)
    expect(librarySyncStore.upsertAlbumOverride as ReturnType<typeof vi.fn>).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/library/overrides/:source/:sourceArtistId', () => {
  it('calls deleteOverride with correct args', async () => {
    const { app, librarySyncStore } = makeSyncApp()
    const res = await app.request('/api/library/overrides/plex/plex-123', { method: 'DELETE' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(librarySyncStore.deleteOverride as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      42,
      'plex',
      'plex-123',
    )
  })
})

describe('POST /api/library/reconcile', () => {
  it('fires syncForUser with force:true and returns 202', async () => {
    const { app, librarySync } = makeSyncApp()
    const res = await app.request('/api/library/reconcile', { method: 'POST' })
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.ok).toBe(true)
    await Promise.resolve()
    expect(librarySync.syncForUser as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(42, {
      force: true,
    })
  })
})
