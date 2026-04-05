// @vitest-environment node

import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SettingsRow } from '@/db/queries/settings'
import type { AppDependencies } from '@/server'
import { createApp } from '@/server'

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
