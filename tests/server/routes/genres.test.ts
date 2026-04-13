// @vitest-environment node

import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSession } from '@/core/sessions'
import type { SettingsRow } from '@/db/queries/settings'
import type { AppDependencies } from '@/server'
import { createApp } from '@/server'

vi.mock('@/core/clients/lidarr', () => ({
  createLidarrClient: vi.fn(() => ({
    getArtists: vi.fn(async () => []),
  })),
}))

vi.mock('@/db/queries/artists', () => ({
  getGenreEnrichments: vi.fn(async () => {
    const m = new Map()
    m.set('Rock', { examples: ['AC/DC', 'Led Zeppelin'], liveCount: 42 })
    m.set('Alternative Rock', { examples: ['Radiohead'], liveCount: 10 })
    return m
  }),
  getArtistsByGenre: vi.fn(async () => []),
}))

function makeMockOrchestrator() {
  const emitter = new EventEmitter()
  return Object.assign(emitter, {
    isRunning: false,
    run: vi.fn(async () => ({ batchId: 1 })),
  })
}

const mockGenres = [
  {
    id: 1,
    name: 'Rock',
    slug: 'rock',
    source: 'library',
    parentGenreId: null,
    artistCount: 42,
    cachedAt: new Date('2024-01-01'),
  },
  {
    id: 2,
    name: 'Alternative Rock',
    slug: 'alternative-rock',
    source: 'library',
    parentGenreId: 1,
    artistCount: 10,
    cachedAt: new Date('2024-01-01'),
  },
]

const mockGenreService = {
  getLibraryGenres: vi.fn(async () => mockGenres),
  search: vi.fn(async () => [mockGenres[0]]),
  getOrFetchGenre: vi.fn(async (slug: string) => mockGenres.find((g) => g.slug === slug) ?? null),
  getSubGenres: vi.fn(async () => [mockGenres[1]]),
  seedFromLibrary: vi.fn(async () => {}),
  slugify: vi.fn((name: string) => name.toLowerCase().replace(/\s+/g, '-')),
  isStale: vi.fn(() => false),
}

function makeChainableMockDb() {
  const chain: Record<string, unknown> = {}
  const terminal = Promise.resolve([])
  const methods = [
    'select',
    'from',
    'where',
    'limit',
    'orderBy',
    'insert',
    'values',
    'onConflictDoUpdate',
    'returning',
    'update',
    'set',
    'delete',
  ]
  for (const m of methods) {
    chain[m] = vi.fn(() => Object.assign(terminal, chain))
  }
  chain.execute = vi.fn(async () => ({ rows: [] }))
  return chain as unknown as AppDependencies['db']
}

function makeDeps(overrides: Partial<AppDependencies> = {}): AppDependencies {
  return {
    db: makeChainableMockDb(),
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
          preferences: {},
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
    updateUserPreferredLocale: vi.fn(async () => {}),
    genreService: mockGenreService as unknown as AppDependencies['genreService'],
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

const SESSION_TOKEN = 'genres-session-token'

async function authedRequest(
  app: ReturnType<typeof createApp>,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  await createSession(1, SESSION_TOKEN)
  return app.request(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${SESSION_TOKEN}`,
      ...((init?.headers as Record<string, string> | undefined) ?? {}),
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGenreService.getLibraryGenres.mockResolvedValue(mockGenres)
  mockGenreService.search.mockResolvedValue([mockGenres[0]])
  mockGenreService.getOrFetchGenre.mockImplementation(
    async (slug: string) => mockGenres.find((g) => g.slug === slug) ?? null,
  )
  mockGenreService.getSubGenres.mockResolvedValue([mockGenres[1]])
})

describe('GET /api/genres', () => {
  it('returns all genres with example artists', async () => {
    const app = createApp(makeDeps())
    const res = await authedRequest(app, '/api/genres')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(2)
    expect(body[0].slug).toBe('rock')
    expect(body[0].artistCount).toBe(42)
    expect(body[0].exampleArtists).toEqual(['AC/DC', 'Led Zeppelin'])
  })
})

describe('GET /api/genres/search', () => {
  it('returns search results for valid query', async () => {
    const app = createApp(makeDeps())
    const res = await authedRequest(app, '/api/genres/search?q=rock')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(mockGenreService.search).toHaveBeenCalledWith('rock')
  })

  it('returns 400 for query shorter than 2 chars', async () => {
    const app = createApp(makeDeps())
    const res = await authedRequest(app, '/api/genres/search?q=r')
    expect(res.status).toBe(400)
  })

  it('returns 400 for missing query', async () => {
    const app = createApp(makeDeps())
    const res = await authedRequest(app, '/api/genres/search')
    expect(res.status).toBe(400)
  })
})

describe('GET /api/genres/:slug', () => {
  it('returns genre with sub-genres when found', async () => {
    const app = createApp(makeDeps())
    const res = await authedRequest(app, '/api/genres/rock')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.slug).toBe('rock')
    expect(Array.isArray(body.subGenres)).toBe(true)
    expect(body.subGenres).toHaveLength(1)
    expect(body.subGenres[0].slug).toBe('alternative-rock')
  })

  it('returns 404 for unknown slug', async () => {
    const app = createApp(makeDeps())
    const res = await authedRequest(app, '/api/genres/does-not-exist')
    expect(res.status).toBe(404)
  })
})

describe('POST /api/genres/seed', () => {
  it('returns 202 when Lidarr is configured', async () => {
    const app = createApp(makeDeps())
    const res = await authedRequest(app, '/api/genres/seed', { method: 'POST' })
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.message).toBeDefined()
  })

  it('returns 400 when Lidarr is not configured', async () => {
    const app = createApp(
      makeDeps({
        getSettings: vi.fn(async () => ({ id: 1 }) as SettingsRow),
      }),
    )
    const res = await authedRequest(app, '/api/genres/seed', { method: 'POST' })
    expect(res.status).toBe(400)
  })
})
