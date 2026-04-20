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

vi.mock('@/core/clients/emby', () => ({
  createEmbyClient: vi.fn(),
}))

vi.mock('@/core/clients/jellyfin', () => ({
  createJellyfinClient: vi.fn(),
}))

import { createEmbyClient } from '@/core/clients/emby'
import { createJellyfinClient } from '@/core/clients/jellyfin'
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
const mockCreateEmbyClient = createEmbyClient as typeof createEmbyClient & {
  mockReturnValue: (value: ReturnType<typeof createEmbyClient>) => void
}
const mockCreateJellyfinClient = createJellyfinClient as typeof createJellyfinClient & {
  mockReturnValue: (value: ReturnType<typeof createJellyfinClient>) => void
}

function emptyConnections() {
  return {
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
  }
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
    updateUserPreferredLocale: vi.fn(async () => {}),
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

describe('GET /api/v1/listening/top-artists', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('prefers ListenBrainz over Last.fm when both are connected', async () => {
    mockGetUserConnections.mockResolvedValue({
      ...emptyConnections(),
      listenbrainzUsername: 'user-lb',
      listenbrainzToken: 'user-lb-token',
      lastfmUsername: 'user-lastfm',
      lastfmApiKey: 'user-lastfm-key',
    })
    const getTopArtistsPaged = vi.fn(async () => ({
      artists: [{ name: 'Dead Can Dance', playCount: 42, mbid: 'mbid-1', source: 'listenbrainz' }],
      totalCount: 17,
    }))
    mockCreateListenBrainzClient.mockReturnValue({
      getTopArtistsPaged,
    } as unknown as ReturnType<typeof createListenBrainzClient>)

    const app = createTestApp(makeDeps())
    const res = await app.request('/api/v1/listening/top-artists?range=this_week&limit=5&offset=0')

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      tracks: [
        {
          artist: 'Dead Can Dance',
          track: '42 plays this week',
          source: 'listenbrainz',
          mbid: 'mbid-1',
        },
      ],
      total: 17,
      offset: 0,
      limit: 5,
      source: 'listenbrainz',
    })
    expect(getTopArtistsPaged).toHaveBeenCalledWith('this_week', { offset: 0, count: 5 })
    expect(createLastFmClient).not.toHaveBeenCalled()
  })

  it('falls back to Last.fm with mapped period when ListenBrainz is unavailable', async () => {
    mockGetUserConnections.mockResolvedValue({
      ...emptyConnections(),
      lastfmUsername: 'user-lastfm',
      lastfmApiKey: 'user-lastfm-key',
    })
    const getTopArtistsPaged = vi.fn(async () => ({
      artists: [{ name: 'Low', playCount: 12, mbid: 'mbid-2', source: 'lastfm' }],
      totalCount: 3,
    }))
    mockCreateLastFmClient.mockReturnValue({
      getTopArtistsPaged,
    } as unknown as ReturnType<typeof createLastFmClient>)

    const app = createTestApp(makeDeps())
    const res = await app.request('/api/v1/listening/top-artists?range=this_month&limit=5&offset=0')

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.source).toBe('lastfm')
    expect(body.tracks).toEqual([
      {
        artist: 'Low',
        track: '12 plays this month',
        source: 'lastfm',
        mbid: 'mbid-2',
      },
    ])
    expect(body.total).toBe(3)
    expect(getTopArtistsPaged).toHaveBeenCalledWith('1month', { page: 1, limit: 5 })
  })

  it('maps back-compat range "month" to "this_month"', async () => {
    mockGetUserConnections.mockResolvedValue({
      ...emptyConnections(),
      listenbrainzUsername: 'user-lb',
      listenbrainzToken: 'user-lb-token',
    })
    const getTopArtistsPaged = vi.fn(async () => ({ artists: [], totalCount: 0 }))
    mockCreateListenBrainzClient.mockReturnValue({
      getTopArtistsPaged,
    } as unknown as ReturnType<typeof createListenBrainzClient>)

    const app = createTestApp(makeDeps())
    await app.request('/api/v1/listening/top-artists?range=month')

    expect(getTopArtistsPaged).toHaveBeenCalledWith('this_month', expect.any(Object))
  })

  it('returns empty tracks with null source when no connections are configured', async () => {
    mockGetUserConnections.mockResolvedValue(emptyConnections())

    const app = createTestApp(makeDeps())
    const res = await app.request('/api/v1/listening/top-artists')

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      tracks: [],
      total: 0,
      offset: 0,
      limit: 5,
      source: null,
    })
  })

  it('derives Last.fm page number from offset', async () => {
    mockGetUserConnections.mockResolvedValue({
      ...emptyConnections(),
      lastfmUsername: 'user-lastfm',
      lastfmApiKey: 'user-lastfm-key',
    })
    const getTopArtistsPaged = vi.fn(async () => ({ artists: [], totalCount: 0 }))
    mockCreateLastFmClient.mockReturnValue({
      getTopArtistsPaged,
    } as unknown as ReturnType<typeof createLastFmClient>)

    const app = createTestApp(makeDeps())
    await app.request('/api/v1/listening/top-artists?range=this_year&limit=5&offset=10')

    expect(getTopArtistsPaged).toHaveBeenCalledWith('12month', { page: 3, limit: 5 })
  })
})

describe('GET /api/v1/listening/recent-tracks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns hasSource=false when no scrobble source is connected', async () => {
    mockGetUserConnections.mockResolvedValue(emptyConnections())

    const app = createTestApp(makeDeps())
    const res = await app.request('/api/v1/listening/recent-tracks')

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ tracks: [], hasSource: false, source: null })
  })

  it('uses Last.fm first when connected and includes now-playing flag', async () => {
    mockGetUserConnections.mockResolvedValue({
      ...emptyConnections(),
      listenbrainzUsername: 'user-lb',
      listenbrainzToken: 'user-lb-token',
      lastfmUsername: 'user-lastfm',
      lastfmApiKey: 'user-lastfm-key',
    })
    mockCreateLastFmClient.mockReturnValue({
      getRecentTracks: vi.fn(async () => [
        {
          artist: { '#text': 'Mogwai' },
          name: 'Auto Rock',
          '@attr': { nowplaying: 'true' },
        },
        {
          artist: { '#text': 'Low' },
          name: 'Sunflower',
          date: { uts: '1700000000', '#text': 'now' },
        },
      ]),
    } as unknown as ReturnType<typeof createLastFmClient>)

    const app = createTestApp(makeDeps())
    const res = await app.request('/api/v1/listening/recent-tracks?limit=2')

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.source).toBe('lastfm')
    expect(body.hasSource).toBe(true)
    expect(body.tracks).toHaveLength(2)
    expect(body.tracks[0].nowPlaying).toBe(true)
    expect(body.tracks[1].playedAt).toBe(new Date(1700000000 * 1000).toISOString())
    expect(createListenBrainzClient).not.toHaveBeenCalled()
  })

  it('falls back to ListenBrainz listens when Last.fm is absent', async () => {
    mockGetUserConnections.mockResolvedValue({
      ...emptyConnections(),
      listenbrainzUsername: 'user-lb',
      listenbrainzToken: 'user-lb-token',
    })
    mockCreateListenBrainzClient.mockReturnValue({
      getListens: vi.fn(async () => [
        {
          artist: 'Godspeed You! Black Emperor',
          track: 'Storm',
          listenedAt: 1700000000,
          artistMbid: 'mbid-3',
        },
      ]),
    } as unknown as ReturnType<typeof createListenBrainzClient>)

    const app = createTestApp(makeDeps())
    const res = await app.request('/api/v1/listening/recent-tracks?limit=1')

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.source).toBe('listenbrainz')
    expect(body.tracks[0].artist).toBe('Godspeed You! Black Emperor')
    expect(body.tracks[0].mbid).toBe('mbid-3')
  })

  it('falls back to Jellyfin when LF and LB are not configured', async () => {
    mockGetUserConnections.mockResolvedValue({
      ...emptyConnections(),
      jellyfinUrl: 'https://jf',
      jellyfinApiKey: 'jf-key',
      jellyfinUserId: 'jf-user',
    })
    mockCreateJellyfinClient.mockReturnValue({
      getRecentlyPlayed: vi.fn(async () => [
        {
          artistName: 'Cocteau Twins',
          trackName: 'Lorelei',
          datePlayed: '2026-04-19T12:00:00Z',
        },
      ]),
    } as unknown as ReturnType<typeof createJellyfinClient>)

    const app = createTestApp(makeDeps())
    const res = await app.request('/api/v1/listening/recent-tracks?limit=1')

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.source).toBe('jellyfin')
    expect(body.tracks[0].artist).toBe('Cocteau Twins')
  })

  it('falls back to Emby when only Emby is configured', async () => {
    mockGetUserConnections.mockResolvedValue({
      ...emptyConnections(),
      embyUrl: 'https://emby',
      embyApiKey: 'emby-key',
      embyUserId: 'emby-user',
    })
    mockCreateEmbyClient.mockReturnValue({
      getRecentlyPlayed: vi.fn(async () => [{ artistName: 'Swans', trackName: 'The Seer' }]),
    } as unknown as ReturnType<typeof createEmbyClient>)

    const app = createTestApp(makeDeps())
    const res = await app.request('/api/v1/listening/recent-tracks?limit=1')

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.source).toBe('emby')
    expect(body.tracks[0].artist).toBe('Swans')
  })
})
