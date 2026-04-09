// @vitest-environment node

import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppDependencies } from '@/server'

vi.mock('@/db/queries/users', () => ({
  getUserConnections: vi.fn(),
}))

vi.mock('@/core/clients/lastfm', () => ({
  createLastFmClient: vi.fn(),
}))

vi.mock('@/core/clients/listenbrainz', () => ({
  createListenBrainzClient: vi.fn(),
}))

vi.mock('@/core/clients/lidarr', () => ({
  createLidarrClient: vi.fn(),
}))

import { createLastFmClient } from '@/core/clients/lastfm'
import { createListenBrainzClient } from '@/core/clients/listenbrainz'
import { getUserConnections } from '@/db/queries/users'
import { listeningRoutes } from '@/server/routes/listening'

const USER_ID = 42
const mockGetUserConnections = getUserConnections as typeof getUserConnections & {
  mockResolvedValue: (value: Awaited<ReturnType<typeof getUserConnections>>) => void
}
const mockCreateLastFmClient = createLastFmClient as typeof createLastFmClient & {
  mockReturnValue: (value: ReturnType<typeof createLastFmClient>) => void
}
const mockCreateListenBrainzClient = createListenBrainzClient as typeof createListenBrainzClient & {
  mockReturnValue: (value: ReturnType<typeof createListenBrainzClient>) => void
}

function makeDeps(
  overrides: Partial<Pick<AppDependencies, 'db' | 'getSettings'>> = {},
): AppDependencies {
  return {
    db: {} as AppDependencies['db'],
    storeDb: {} as AppDependencies['storeDb'],
    orchestrator: {} as AppDependencies['orchestrator'],
    scheduler: {} as AppDependencies['scheduler'],
    providerRegistry: {} as AppDependencies['providerRegistry'],
    isSetupComplete: vi.fn(async () => true),
    getSettings: vi.fn(
      async () =>
        ({
          id: 1,
          setupComplete: true,
          lidarrUrl: null,
          lidarrApiKey: null,
          skipTlsVerify: false,
          listenbrainzUsername: 'global-lb',
          listenbrainzToken: 'global-lb-token',
          lastfmUsername: 'global-lastfm',
          lastfmApiKey: 'global-lastfm-key',
        }) as Awaited<ReturnType<AppDependencies['getSettings']>>,
    ),
    updateSettings: vi.fn(async () => {}),
    completeSetup: vi.fn(async () => ({})),
    getLastBatch: vi.fn(async () => null),
    listRecommendations: vi.fn(async () => ({ items: [], total: 0 })),
    getRecommendation: vi.fn(async () => null),
    updateRecommendationStatus: vi.fn(async () => {}),
    bulkUpdateStatus: vi.fn(async () => {}),
    filterOwnedIds: vi.fn(async () => []),
    listBatches: vi.fn(async () => []),
    getBatch: vi.fn(async () => null),
    getArtistById: vi.fn(async () => null),
    restartScheduler: vi.fn(),
    restartPlaylistScheduler: vi.fn(async () => {}),
    createUser: vi.fn(async () => ({
      id: 1,
      username: 'user',
      isAdmin: false,
    })) as unknown as AppDependencies['createUser'],
    getUserByUsername: vi.fn(async () => null),
    getUserById: vi.fn(async () => null),
    getUserCount: vi.fn(async () => 1),
    updatePassword: vi.fn(async () => {}),
    getOidcService: vi.fn(async () => null),
    getUserByOidcSubject: vi.fn(async () => null),
    getUserByEmail: vi.fn(async () => null),
    updateUser: vi.fn(async () => {}),
    listUsers: vi.fn(async () => []),
    deleteUser: vi.fn(async () => {}),
    genreService: {} as AppDependencies['genreService'],
    libraryHealth: {} as AppDependencies['libraryHealth'],
    librarySync: {} as AppDependencies['librarySync'],
    librarySyncStore: {} as AppDependencies['librarySyncStore'],
    subscriptionQueries: {} as AppDependencies['subscriptionQueries'],
    runSubscription: vi.fn(async () => {}),
    targetQueries: {} as AppDependencies['targetQueries'],
    testTargetConnection: vi.fn(async () => ({ success: true, message: 'ok' })),
    getEnabledTargetsForUser: vi.fn(async () => []),
    getFeedbackHistory: vi.fn(async () => new Map()),
    dashboardQueries: {
      getTopGenresForUser: vi.fn(async () => []),
      getRecentActivity: vi.fn(async () => []),
    },
    jobRecorder: {} as AppDependencies['jobRecorder'],
    jobQueries: {} as AppDependencies['jobQueries'],
    ...overrides,
  }
}

function createTestApp(deps: AppDependencies, userId = USER_ID) {
  const app = new Hono()
  app.use('*', async (c, next) => {
    c.set('userId' as never, userId as never)
    await next()
  })
  app.route('/', listeningRoutes(deps))
  return app
}

describe('GET /api/listening/recent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns recent Last.fm tracks from the authenticated user connection', async () => {
    mockGetUserConnections.mockResolvedValue({
      listenbrainzUsername: null,
      listenbrainzToken: null,
      lastfmUsername: 'user-lastfm',
      lastfmApiKey: 'user-lastfm-key',
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
    })
    mockCreateLastFmClient.mockReturnValue({
      getRecentTracks: vi.fn(async () => [{ artist: { '#text': 'Mogwai' }, name: 'Auto Rock' }]),
    } as unknown as ReturnType<typeof createLastFmClient>)

    const app = createTestApp(makeDeps())
    const res = await app.request('/api/listening/recent')

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      tracks: [{ artist: 'Mogwai', track: 'Auto Rock', source: 'lastfm' }],
    })
    expect(createLastFmClient).toHaveBeenCalledWith('user-lastfm', 'user-lastfm-key')
  })

  it('does not fall back to global Last.fm or ListenBrainz for authenticated users', async () => {
    mockGetUserConnections.mockResolvedValue({
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
    })

    const app = createTestApp(makeDeps())
    const res = await app.request('/api/listening/recent')

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ tracks: [] })
    expect(createLastFmClient).not.toHaveBeenCalled()
    expect(createListenBrainzClient).not.toHaveBeenCalled()
  })

  it('falls back to the authenticated user ListenBrainz connection when Last.fm has no tracks', async () => {
    mockGetUserConnections.mockResolvedValue({
      listenbrainzUsername: 'user-lb',
      listenbrainzToken: 'user-lb-token',
      lastfmUsername: 'user-lastfm',
      lastfmApiKey: 'user-lastfm-key',
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
    })
    mockCreateLastFmClient.mockReturnValue({
      getRecentTracks: vi.fn(async () => []),
    } as unknown as ReturnType<typeof createLastFmClient>)
    mockCreateListenBrainzClient.mockReturnValue({
      getTopArtists: vi.fn(async () => [{ name: 'Low', playCount: 12, mbid: 'mbid-1' }]),
    } as unknown as ReturnType<typeof createListenBrainzClient>)

    const app = createTestApp(makeDeps())
    const res = await app.request('/api/listening/recent?range=month&limit=1')

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      tracks: [
        {
          artist: 'Low',
          track: '12 plays this month',
          source: 'listenbrainz',
          mbid: 'mbid-1',
        },
      ],
    })
    expect(createLastFmClient).toHaveBeenCalledWith('user-lastfm', 'user-lastfm-key')
    expect(createListenBrainzClient).toHaveBeenCalledWith('user-lb', 'user-lb-token')
  })
})
