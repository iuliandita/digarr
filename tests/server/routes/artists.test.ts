// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSession } from '@/core/sessions'
import type { SettingsRow } from '@/db/queries/settings'
import type { AppDependencies } from '@/server'
import { createApp } from '@/server'
import { makeDeps as makeSharedDeps } from '../../helpers/test-app'

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

const wikidataGetEnrichment = vi.fn()
vi.mock('@/core/clients/wikidata', () => ({
  createWikidataClient: vi.fn(() => ({
    getArtistEnrichment: wikidataGetEnrichment,
  })),
}))

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
  return makeSharedDeps({
    db: makeChainableMockDb(),
    storeDb: {} as unknown as AppDependencies['storeDb'],
    scheduler: {} as AppDependencies['scheduler'],
    providerRegistry: {} as unknown as AppDependencies['providerRegistry'],
    getSettings: vi.fn(
      async () =>
        ({
          id: 1,
          lidarrUrl: 'http://lidarr:8686',
          lidarrApiKey: 'key',
          preferences: {},
        }) as SettingsRow,
    ),
    getUserById: vi.fn(async () => null),
    getUserCount: vi.fn(async () => 0),
    ...overrides,
  })
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
  genresCachedAt: null,
  beginYear: 1991,
  endYear: null,
  topTracks: null,
  description: null,
  externalLinks: null,
  wikidataId: null,
  wikidataFetchedAt: null,
  wikidataFailedAt: null,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/v1/artists/:id', () => {
  it('rejects fractional ids before querying', async () => {
    const getArtistById = vi.fn(async () => MOCK_ARTIST)
    const app = createApp(makeDeps({ getArtistById }))
    const res = await authedRequest(app, '/api/v1/artists/1.5')
    expect(res.status).toBe(400)
    expect(getArtistById).not.toHaveBeenCalled()
  })
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

type ArtistLike = typeof MOCK_ARTIST
function makeEnrichmentDb(artist: ArtistLike | null) {
  const setCalls: Array<Record<string, unknown>> = []
  const db = {
    query: {
      artists: {
        findFirst: vi.fn(async () => artist),
      },
    },
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        setCalls.push(values)
        return { where: vi.fn(async () => undefined) }
      }),
    })),
  }
  return { db: db as unknown as AppDependencies['db'], setCalls }
}

const enrichmentSettings = (override: Partial<SettingsRow> = {}): SettingsRow =>
  ({ id: 1, wikidataEnabled: true, ...override }) as SettingsRow

describe('GET /api/v1/artists/:id/enrichment', () => {
  beforeEach(() => {
    wikidataGetEnrichment.mockReset()
  })

  it('returns cached description when within TTL', async () => {
    const { db } = makeEnrichmentDb({
      ...MOCK_ARTIST,
      description: { en: 'English blurb' } as unknown as null,
      externalLinks: { wikipedia: 'https://en.wikipedia.org/wiki/X' } as unknown as null,
      wikidataId: 'Q1' as unknown as null,
      wikidataFetchedAt: new Date() as unknown as null,
    })
    const app = createApp(
      makeDeps({
        db,
        getSettings: vi.fn(async () => enrichmentSettings()),
      }),
    )
    const res = await authedRequest(app, '/api/v1/artists/1/enrichment?locale=en')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.description).toBe('English blurb')
    expect(wikidataGetEnrichment).not.toHaveBeenCalled()
  })

  it('fetches from Wikidata on cache miss and persists', async () => {
    wikidataGetEnrichment.mockResolvedValueOnce({
      wikidataId: 'Q2',
      description: 'Fresh bio',
      externalLinks: { wikipedia: 'https://en.wikipedia.org/wiki/Y' },
    })
    const { db, setCalls } = makeEnrichmentDb({ ...MOCK_ARTIST })
    const app = createApp(
      makeDeps({
        db,
        getSettings: vi.fn(async () => enrichmentSettings()),
      }),
    )
    const res = await authedRequest(app, '/api/v1/artists/1/enrichment?locale=en')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.description).toBe('Fresh bio')
    expect(wikidataGetEnrichment).toHaveBeenCalledWith(MOCK_ARTIST.mbid, 'en')
    expect(setCalls[0]).toMatchObject({ wikidataId: 'Q2' })
  })

  it('stamps failure and returns empty when Wikidata yields nothing', async () => {
    wikidataGetEnrichment.mockResolvedValueOnce({
      wikidataId: null,
      description: null,
      externalLinks: {},
    })
    const { db, setCalls } = makeEnrichmentDb({ ...MOCK_ARTIST })
    const app = createApp(
      makeDeps({
        db,
        getSettings: vi.fn(async () => enrichmentSettings()),
      }),
    )
    const res = await authedRequest(app, '/api/v1/artists/1/enrichment?locale=en')
    const body = await res.json()
    expect(body.description).toBeNull()
    expect(setCalls[0]).toHaveProperty('wikidataFailedAt')
  })

  it('skips Wikidata within 24h of prior failure', async () => {
    const { db } = makeEnrichmentDb({
      ...MOCK_ARTIST,
      wikidataFailedAt: new Date() as unknown as null,
    })
    const app = createApp(
      makeDeps({
        db,
        getSettings: vi.fn(async () => enrichmentSettings()),
      }),
    )
    await authedRequest(app, '/api/v1/artists/1/enrichment?locale=en')
    expect(wikidataGetEnrichment).not.toHaveBeenCalled()
  })

  it('returns empty without calling Wikidata when wikidataEnabled=false', async () => {
    const { db } = makeEnrichmentDb({ ...MOCK_ARTIST })
    const app = createApp(
      makeDeps({
        db,
        getSettings: vi.fn(async () => enrichmentSettings({ wikidataEnabled: false })),
      }),
    )
    const res = await authedRequest(app, '/api/v1/artists/1/enrichment?locale=en')
    const body = await res.json()
    expect(body.description).toBeNull()
    expect(wikidataGetEnrichment).not.toHaveBeenCalled()
  })

  it('returns 404 when artist not found', async () => {
    const { db } = makeEnrichmentDb(null)
    const app = createApp(makeDeps({ db, getSettings: vi.fn(async () => enrichmentSettings()) }))
    const res = await authedRequest(app, '/api/v1/artists/999/enrichment?locale=en')
    expect(res.status).toBe(404)
  })
})

describe('preview audio proxy redirects', () => {
  const GOOD = 'https://cdns-preview-a.dzcdn.net/stream/a.mp3'
  const audio = () => new Response('abc', { headers: { 'Content-Type': 'audio/mpeg' } })
  const redirect = (to: string) => new Response(null, { status: 302, headers: { Location: to } })

  it('follows a redirect that stays on the allowlist', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(redirect('https://cdns-preview-b.dzcdn.net/stream/b.mp3'))
      .mockResolvedValueOnce(audio())
    const app = createApp(makeDeps())
    const res = await authedRequest(app, `/api/v1/preview/audio?url=${encodeURIComponent(GOOD)}`)
    expect(res.status).toBe(200)
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' })
    fetchMock.mockRestore()
  })

  it('refuses a redirect to a non-allowlisted host', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(redirect('http://169.254.169.254/latest'))
    const app = createApp(makeDeps())
    const res = await authedRequest(app, `/api/v1/preview/audio?url=${encodeURIComponent(GOOD)}`)
    expect(res.status).toBe(502)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    fetchMock.mockRestore()
  })

  it('stops after too many redirects', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => redirect(GOOD))
    const app = createApp(makeDeps())
    const res = await authedRequest(app, `/api/v1/preview/audio?url=${encodeURIComponent(GOOD)}`)
    expect(res.status).toBe(502)
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(4)
    fetchMock.mockRestore()
  })
})
