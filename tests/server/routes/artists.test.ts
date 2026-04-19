// @vitest-environment node

import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSession } from '@/core/sessions'
import type { SettingsRow } from '@/db/queries/settings'
import type { AppDependencies } from '@/server'
import { createApp } from '@/server'

vi.mock('@/core/clients/deezer', () => ({
  createDeezerClient: vi.fn(() => ({
    searchArtists: vi.fn(async () => []),
    getArtistTopTracks: vi.fn(async () => []),
  })),
}))

vi.mock('@/core/clients/musicbrainz', () => ({
  createMusicBrainzClient: vi.fn(() => ({
    lookupArtist: vi.fn(async () => ({})),
    searchArtist: vi.fn(async () => ({ artists: [] })),
    getReleaseGroups: vi.fn(async () => []),
    getRecordings: vi.fn(async () => []),
    extractStreamingUrls: vi.fn(() => ({})),
  })),
}))

function makeMockOrchestrator() {
  const emitter = new EventEmitter()
  return Object.assign(emitter, {
    isRunning: false,
    run: vi.fn(async () => ({ batchId: 1 })),
  })
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
    genreService: {
      getLibraryGenres: vi.fn(async () => []),
      search: vi.fn(async () => []),
      getOrFetchGenre: vi.fn(async () => null),
      getSubGenres: vi.fn(async () => []),
      seedFromLibrary: vi.fn(async () => {}),
      slugify: vi.fn((name: string) => name),
      isStale: vi.fn(() => false),
    } as unknown as AppDependencies['genreService'],
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

const SESSION_TOKEN = 'artists-session-token'

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

const MOCK_ARTIST = {
  id: 1,
  mbid: 'a3cb23fc-acd3-4ce0-8f36-1e5aa6a18432',
  name: 'Portishead',
  disambiguation: null,
  tags: ['trip-hop'],
  genres: ['trip-hop'],
  imageUrl: null,
  logoUrl: null,
  streamingUrls: null,
  imageFailedAt: null,
  cachedAt: null,
  beginYear: 1991,
  endYear: null,
  topTracks: null,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/v1/artists/:id/top-tracks', () => {
  it('returns 404 for unknown artist', async () => {
    const app = createApp(makeDeps())
    const res = await authedRequest(app, '/api/v1/artists/999/top-tracks')
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body).toHaveProperty('error', 'Artist not found')
  })

  it('returns cached tracks when fresh', async () => {
    const cachedTracks = {
      tracks: [
        {
          name: 'Glory Box',
          previewUrl: 'https://cdn.deezer.com/preview/1.mp3',
          durationMs: 30000,
        },
        { name: 'Sour Times', durationMs: 32000 },
      ],
      cachedAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(), // 1 hour ago
    }

    const app = createApp(
      makeDeps({
        getArtistById: vi.fn(async () => ({
          ...MOCK_ARTIST,
          topTracks: cachedTracks,
        })),
      }),
    )

    const res = await authedRequest(app, '/api/v1/artists/1/top-tracks')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('tracks')
    expect(body.tracks).toHaveLength(2)
    expect(body.tracks[0].name).toBe('Glory Box')
  })

  it('does not call external APIs when cache is fresh', async () => {
    const { createDeezerClient } = await import('@/core/clients/deezer')
    const mockClient = (
      createDeezerClient as unknown as () => Record<string, ReturnType<typeof vi.fn>>
    )()

    const app = createApp(
      makeDeps({
        getArtistById: vi.fn(async () => ({
          ...MOCK_ARTIST,
          topTracks: {
            tracks: [{ name: 'Glory Box' }],
            cachedAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
          },
        })),
      }),
    )

    await authedRequest(app, '/api/v1/artists/1/top-tracks')
    expect(mockClient.searchArtists).not.toHaveBeenCalled()
    expect(mockClient.getArtistTopTracks).not.toHaveBeenCalled()
  })

  it('fetches from Deezer when no cached tracks', async () => {
    const { createDeezerClient } = await import('@/core/clients/deezer')
    const deezerMock = createDeezerClient as ReturnType<typeof vi.fn>
    const mockSearchArtists = vi.fn(async () => [
      { id: 42, name: 'Portishead', fans: 100000, url: 'https://deezer.com/artist/42' },
    ])
    const mockGetTopTracks = vi.fn(async () => [
      { name: 'Glory Box', previewUrl: 'https://cdn.deezer.com/preview/1.mp3', durationMs: 30000 },
    ])
    deezerMock.mockReturnValue({
      searchArtists: mockSearchArtists,
      getArtistTopTracks: mockGetTopTracks,
    })

    const app = createApp(
      makeDeps({
        getArtistById: vi.fn(async () => ({ ...MOCK_ARTIST })),
      }),
    )

    const res = await authedRequest(app, '/api/v1/artists/1/top-tracks')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.tracks).toHaveLength(1)
    expect(body.tracks[0].name).toBe('Glory Box')
    expect(mockSearchArtists).toHaveBeenCalledWith('Portishead', 10)
    expect(mockGetTopTracks).toHaveBeenCalledWith(42, 5)
  })

  it('skips Deezer when multiple artists share the same name', async () => {
    const { createDeezerClient } = await import('@/core/clients/deezer')
    const deezerMock = createDeezerClient as ReturnType<typeof vi.fn>
    const mockGetTopTracks = vi.fn(async () => [{ name: 'Wrong Track', durationMs: 30000 }])
    deezerMock.mockReturnValue({
      searchArtists: vi.fn(async () => [
        { id: 11, name: 'Portishead', fans: 500, url: 'https://deezer.com/artist/11' },
        { id: 42, name: 'Portishead', fans: 100000, url: 'https://deezer.com/artist/42' },
      ]),
      getArtistTopTracks: mockGetTopTracks,
    })

    const { createMusicBrainzClient } = await import('@/core/clients/musicbrainz')
    const mbMock = createMusicBrainzClient as ReturnType<typeof vi.fn>
    mbMock.mockReturnValue({
      getRecordings: vi.fn(async () => [{ title: 'Sour Times' }, { title: 'Glory Box' }]),
    })

    const app = createApp(
      makeDeps({
        getArtistById: vi.fn(async () => ({ ...MOCK_ARTIST })),
      }),
    )

    const res = await authedRequest(app, '/api/v1/artists/1/top-tracks')
    expect(res.status).toBe(200)
    const body = await res.json()
    // Should NOT have called Deezer top tracks (ambiguous name)
    expect(mockGetTopTracks).not.toHaveBeenCalled()
    // Should fall through to MusicBrainz recordings
    expect(body.tracks[0].name).toBe('Sour Times')
  })

  it('returns empty tracks when artist has no data and external APIs fail', async () => {
    const { createDeezerClient } = await import('@/core/clients/deezer')
    const deezerMock = createDeezerClient as ReturnType<typeof vi.fn>
    deezerMock.mockReturnValue({
      searchArtists: vi.fn(async () => []),
      getArtistTopTracks: vi.fn(async () => []),
    })

    const { createMusicBrainzClient } = await import('@/core/clients/musicbrainz')
    const mbMock = createMusicBrainzClient as ReturnType<typeof vi.fn>
    mbMock.mockReturnValue({
      getRecordings: vi.fn(async () => {
        throw new Error('MB timeout')
      }),
    })

    const app = createApp(
      makeDeps({
        getArtistById: vi.fn(async () => ({ ...MOCK_ARTIST })),
      }),
    )

    const res = await authedRequest(app, '/api/v1/artists/1/top-tracks')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('tracks')
    expect(body.tracks).toHaveLength(0)
  })

  it('falls back to MusicBrainz recordings when Deezer finds no artist', async () => {
    const { createDeezerClient } = await import('@/core/clients/deezer')
    const deezerMock = createDeezerClient as ReturnType<typeof vi.fn>
    deezerMock.mockReturnValue({
      searchArtists: vi.fn(async () => []),
      getArtistTopTracks: vi.fn(async () => []),
    })

    const { createMusicBrainzClient } = await import('@/core/clients/musicbrainz')
    const mbMock = createMusicBrainzClient as ReturnType<typeof vi.fn>
    mbMock.mockReturnValue({
      getRecordings: vi.fn(async () => [
        { id: 'rec-1', title: 'Sour Times' },
        { id: 'rec-2', title: 'Glory Box' },
      ]),
    })

    const app = createApp(
      makeDeps({
        getArtistById: vi.fn(async () => ({ ...MOCK_ARTIST })),
      }),
    )

    const res = await authedRequest(app, '/api/v1/artists/1/top-tracks')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.tracks).toHaveLength(2)
    expect(body.tracks[0].name).toBe('Sour Times')
    expect(body.tracks[0].previewUrl).toBeUndefined()
  })

  it('re-fetches when cache is stale (older than 30 days)', async () => {
    const { createDeezerClient } = await import('@/core/clients/deezer')
    const deezerMock = createDeezerClient as ReturnType<typeof vi.fn>
    const mockSearchArtists = vi.fn(async () => [
      { id: 42, name: 'Portishead', fans: 100000, url: 'https://deezer.com/artist/42' },
    ])
    const mockGetTopTracks = vi.fn(async () => [{ name: 'Numb', durationMs: 28000 }])
    deezerMock.mockReturnValue({
      searchArtists: mockSearchArtists,
      getArtistTopTracks: mockGetTopTracks,
    })

    const staleCachedAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) // 31 days ago

    const app = createApp(
      makeDeps({
        getArtistById: vi.fn(async () => ({
          ...MOCK_ARTIST,
          topTracks: {
            tracks: [{ name: 'Old Track' }],
            cachedAt: staleCachedAt.toISOString(),
          },
        })),
      }),
    )

    const res = await authedRequest(app, '/api/v1/artists/1/top-tracks')
    expect(res.status).toBe(200)
    const body = await res.json()
    // Should have the fresh Deezer data, not the stale cache
    expect(body.tracks[0].name).toBe('Numb')
    expect(mockSearchArtists).toHaveBeenCalled()
  })
})
