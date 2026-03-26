// @vitest-environment node

import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SettingsRow } from '@/db/queries/settings'
import type { AppDependencies } from '@/server'
import { dashboardRoutes } from '@/server/routes/dashboard'

const USER_ID = 42

function makeDeps(overrides: Partial<AppDependencies> = {}): AppDependencies {
  return {
    db: { execute: vi.fn(async () => []) } as unknown as AppDependencies['db'],
    storeDb: {} as unknown as AppDependencies['storeDb'],
    orchestrator: {} as unknown as AppDependencies['orchestrator'],
    scheduler: {
      schedule: vi.fn(),
      remove: vi.fn(),
      has: vi.fn(() => false),
      listJobs: vi.fn(() => []),
      stopAll: vi.fn(),
      nextRun: vi.fn(() => null),
    } as unknown as AppDependencies['scheduler'],
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
      discogsToken: null,
      discogsUsername: null,
      createdAt: new Date(),
    })),
    getUserByUsername: vi.fn(async () => null),
    getUserById: vi.fn(async (id: number) =>
      id === USER_ID
        ? {
            id: USER_ID,
            username: 'testuser',
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
          }
        : null,
    ),
    getUserCount: vi.fn(async () => 0),
    updatePassword: vi.fn(async () => {}),
    genreService: {
      getLibraryGenres: vi.fn(async () => []),
      search: vi.fn(async () => []),
      getOrFetchGenre: vi.fn(async () => null),
      getSubGenres: vi.fn(async () => []),
      seedFromLibrary: vi.fn(async () => {}),
      slugify: vi.fn((name: string) => name.toLowerCase()),
      isStale: vi.fn(() => false),
    } as unknown as AppDependencies['genreService'],
    libraryHealth: {} as unknown as AppDependencies['libraryHealth'],
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
      createSubscription: vi.fn(),
      getSubscription: vi.fn(),
      getSubscriptionsByUser: vi.fn(),
      getEnabledSubscriptions: vi.fn(),
      updateSubscription: vi.fn(),
      deleteSubscription: vi.fn(),
      getRunsForSubscription: vi.fn(),
    } as unknown as AppDependencies['subscriptionQueries'],
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
    ...overrides,
  }
}

function createTestApp(deps: AppDependencies, userId: number | undefined) {
  const app = new Hono()
  app.use('*', async (c, next) => {
    if (userId !== undefined) {
      c.set('userId' as never, userId as never)
    }
    return next()
  })
  app.route('/', dashboardRoutes(deps))
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/dashboard/taste', () => {
  it('returns array of taste genres', async () => {
    const mockResult = [{ genre: 'post-rock', count: 5, percentage: 32 }]
    const deps = makeDeps({
      dashboardQueries: {
        getTopGenresForUser: vi.fn(async () => mockResult),
        getRecentActivity: vi.fn(async () => []),
      },
    })
    const app = createTestApp(deps, USER_ID)
    const res = await app.request('/api/dashboard/taste')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(1)
    expect(body[0]).toMatchObject({ genre: 'post-rock', count: 5, percentage: 32 })
    expect(deps.dashboardQueries.getTopGenresForUser).toHaveBeenCalledWith(USER_ID)
  })

  it('passes undefined userId when not authenticated', async () => {
    const deps = makeDeps()
    const app = createTestApp(deps, undefined)
    const res = await app.request('/api/dashboard/taste')
    expect(res.status).toBe(200)
    expect(deps.dashboardQueries.getTopGenresForUser).toHaveBeenCalledWith(undefined)
  })
})

describe('GET /api/dashboard/activity', () => {
  it('returns array of activity entries', async () => {
    const mockActivity = [
      {
        type: 'approved' as const,
        timestamp: '2026-03-21T10:00:00Z',
        data: { artistName: 'Slowdive' },
      },
    ]
    const deps = makeDeps({
      dashboardQueries: {
        getTopGenresForUser: vi.fn(async () => []),
        getRecentActivity: vi.fn(async () => mockActivity),
      },
    })
    const app = createTestApp(deps, USER_ID)
    const res = await app.request('/api/dashboard/activity')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(1)
    expect(body[0]).toMatchObject({ type: 'approved', data: { artistName: 'Slowdive' } })
  })

  it('passes limit from query param', async () => {
    const deps = makeDeps()
    const app = createTestApp(deps, USER_ID)
    const res = await app.request('/api/dashboard/activity?limit=3')
    expect(res.status).toBe(200)
    expect(deps.dashboardQueries.getRecentActivity).toHaveBeenCalledWith(
      USER_ID,
      expect.any(Boolean),
      3,
    )
  })

  it('caps limit at 20', async () => {
    const deps = makeDeps()
    const app = createTestApp(deps, USER_ID)
    const res = await app.request('/api/dashboard/activity?limit=100')
    expect(res.status).toBe(200)
    expect(deps.dashboardQueries.getRecentActivity).toHaveBeenCalledWith(
      USER_ID,
      expect.any(Boolean),
      20,
    )
  })
})
