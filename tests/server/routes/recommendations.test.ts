// @vitest-environment node

import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SettingsRow } from '@/db/queries/settings'
import type { AppDependencies } from '@/server'
import { createApp } from '@/server'

// Hoist the mock so vitest can resolve it before imports
vi.mock('@/core/clients/lidarr', () => ({
  createLidarrClient: vi.fn(),
}))

// Mock sessions so auth middleware sets userId
vi.mock('@/core/sessions', () => ({
  getSession: vi.fn(async () => ({
    userId: 1,
    token: 'test-token',
    expiresAt: new Date(Date.now() + 86400000),
  })),
  setSessionStore: vi.fn(),
}))

import { createLidarrClient } from '@/core/clients/lidarr'

function makeMockOrchestrator() {
  const emitter = new EventEmitter()
  return Object.assign(emitter, {
    isRunning: false,
    run: vi.fn(async () => ({ batchId: 1 })),
  })
}

const mockArtist = {
  id: 10,
  mbid: 'mbid-abc-123',
  name: 'Test Artist',
  disambiguation: null,
  tags: null,
  genres: null,
  imageUrl: null,
  logoUrl: null,
  streamingUrls: null,
  imageFailedAt: null,
  cachedAt: new Date('2024-01-01'),
  beginYear: null,
  endYear: null,
  topTracks: null,
}

const mockRecommendation = {
  id: 1,
  userId: null,
  artistId: 10,
  batchId: 1,
  score: 0.85,
  status: 'pending',
  sources: null,
  aiReasoning: null,
  reasons: [],
  lidarrArtistId: null,
  lidarrError: null,
  recommendedReleaseGroupId: null,
  recommendedReleaseGroupTitle: null,
  targetActions: null,
  actedOnAt: null,
  createdAt: new Date('2024-01-01'),
  artist: mockArtist,
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
    listRecommendations: vi.fn(async () => ({ items: [mockRecommendation], total: 1 })),
    getRecommendation: vi.fn(async (id: number) => (id === 1 ? mockRecommendation : null)),
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
    libraryHealth: {} as unknown as AppDependencies['libraryHealth'],
    librarySync: {} as unknown as AppDependencies['librarySync'],
    librarySyncStore: {} as unknown as AppDependencies['librarySyncStore'],
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
    getFeedbackHistory: vi.fn(async () => new Map()),
    getOidcService: vi.fn(async () => null),
    getUserByOidcSubject: vi.fn(async () => null),
    getUserByEmail: vi.fn(async () => null),
    updateUser: vi.fn(async () => {}),
    listUsers: vi.fn(async () => []),
    deleteUser: vi.fn(async () => {}),
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

describe('GET /api/recommendations', () => {
  it('returns list and total', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/recommendations')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.total).toBe(1)
    expect(body.items).toHaveLength(1)
    expect(body.items[0].id).toBe(1)
  })

  it('passes filters to listRecommendations', async () => {
    const listRecommendations = vi.fn(async () => ({ items: [], total: 0 }))
    const app = createApp(makeDeps({ listRecommendations }))
    await app.request('/api/recommendations?status=pending&limit=5&offset=10')
    expect(listRecommendations).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending', limit: 5, offset: 10 }),
    )
  })
})

describe('GET /api/recommendations/:id', () => {
  it('returns 200 with recommendation when found', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/recommendations/1')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe(1)
    expect(body.artist.mbid).toBe('mbid-abc-123')
  })

  it('returns 404 when not found', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/recommendations/999')
    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/recommendations/:id', () => {
  it('updates to rejected status without calling Lidarr', async () => {
    const updateRecommendationStatus = vi.fn(async () => {})
    const app = createApp(makeDeps({ updateRecommendationStatus }))
    const res = await app.request('/api/recommendations/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'rejected' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('rejected')
    expect(updateRecommendationStatus).toHaveBeenCalledWith(1, 'rejected')
  })

  it('approve triggers target add and sets added_to_lidarr on success', async () => {
    const updateRecommendationStatus = vi.fn(async () => {})
    const mockTarget = {
      id: 'lidarr-1',
      type: 'lidarr',
      capabilities: ['addArtist'],
      addArtist: vi.fn().mockResolvedValue({
        success: true,
        targetType: 'lidarr',
        targetId: 1,
        externalId: 99,
      }),
    }

    const app = createApp(
      makeDeps({
        updateRecommendationStatus,
        getUserCount: vi.fn(async () => 1),
        getEnabledTargetsForUser: vi.fn().mockResolvedValue([mockTarget]),
      }),
    )
    const res = await app.request('/api/recommendations/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      body: JSON.stringify({ status: 'approved' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('added_to_lidarr')
    expect(updateRecommendationStatus).toHaveBeenCalledWith(
      1,
      'added_to_lidarr',
      expect.objectContaining({ lidarrArtistId: 99 }),
    )
  })

  it('approve sets add_failed when target fails', async () => {
    const updateRecommendationStatus = vi.fn(async () => {})
    const mockTarget = {
      id: 'lidarr-1',
      type: 'lidarr',
      capabilities: ['addArtist'],
      addArtist: vi.fn().mockResolvedValue({
        success: false,
        targetType: 'lidarr',
        targetId: 1,
        error: 'Lidarr down',
      }),
    }

    const app = createApp(
      makeDeps({
        updateRecommendationStatus,
        getUserCount: vi.fn(async () => 1),
        getEnabledTargetsForUser: vi.fn().mockResolvedValue([mockTarget]),
      }),
    )
    const res = await app.request('/api/recommendations/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      body: JSON.stringify({ status: 'approved' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('add_failed')
    expect(body.lidarrError).toMatch(/lidarr down/i)
    expect(updateRecommendationStatus).toHaveBeenCalledWith(
      1,
      'add_failed',
      expect.objectContaining({ lidarrError: expect.any(String) }),
    )
  })

  it('returns 400 when status is missing', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/recommendations/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('returns 404 for approve when recommendation not found', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/recommendations/999', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    })
    expect(res.status).toBe(404)
  })

  it('passes per-request profile overrides to target addArtist', async () => {
    const mockAddArtist = vi.fn().mockResolvedValue({
      success: true,
      targetType: 'lidarr',
      targetId: 1,
      externalId: 99,
    })
    const mockTarget = {
      id: 'lidarr-1',
      name: 'Lidarr',
      type: 'lidarr',
      capabilities: ['addArtist'],
      addArtist: mockAddArtist,
      testConnection: vi.fn(),
    }

    const app = createApp(
      makeDeps({
        getEnabledTargetsForUser: vi.fn().mockResolvedValue([mockTarget]),
      }),
    )

    const res = await app.request('/api/recommendations/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      body: JSON.stringify({
        status: 'approved',
        qualityProfileId: 5,
        metadataProfileId: 3,
        rootFolderId: 2,
      }),
    })

    expect(res.status).toBe(200)
    expect(mockAddArtist).toHaveBeenCalledWith(
      { mbid: 'mbid-abc-123', name: 'Test Artist' },
      expect.objectContaining({
        qualityProfileId: 5,
        metadataProfileId: 3,
        rootFolderId: 2,
      }),
    )
  })
})

describe('POST /api/recommendations/bulk', () => {
  it('bulk rejects without calling Lidarr', async () => {
    const bulkUpdateStatus = vi.fn(async () => {})
    const filterOwnedIds = vi.fn(async (ids: number[]) => ids)
    const app = createApp(makeDeps({ bulkUpdateStatus, filterOwnedIds }))
    const res = await app.request('/api/recommendations/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [1, 2, 3], action: 'reject' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.updated).toBe(3)
    expect(filterOwnedIds).toHaveBeenCalledWith([1, 2, 3], undefined)
    expect(bulkUpdateStatus).toHaveBeenCalledWith([1, 2, 3], 'rejected')
  })

  it('returns 400 for invalid action', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/recommendations/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [1], action: 'delete' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 for missing ids', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/recommendations/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [], action: 'reject' }),
    })
    expect(res.status).toBe(400)
  })
})

describe('GET /api/recommendations/feedback-summary', () => {
  it('returns genre feedback summary sorted by approval rate', async () => {
    const history = new Map([
      ['rock', { approved: 8, total: 10 }],
      ['jazz', { approved: 2, total: 5 }],
      ['pop', { approved: 1, total: 1 }],
    ])
    const app = createApp(
      makeDeps({
        getFeedbackHistory: vi.fn().mockResolvedValue(history),
      }),
    )
    const res = await app.request('/api/recommendations/feedback-summary')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.summary).toHaveLength(2) // pop excluded (below 3 total)
    expect(body.summary[0].genre).toBe('rock')
    expect(body.summary[0].rate).toBe(0.8)
    expect(body.summary[1].genre).toBe('jazz')
  })

  it('returns empty summary when no feedback data', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/recommendations/feedback-summary')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.summary).toHaveLength(0)
  })
})
