import { describe, expect, it } from 'vitest'
import { buildSearchSourceCatalog } from '@/core/search/catalog'
import { createDeezerSearchSource } from '@/core/search/sources/deezer'
import { createMusicBrainzSearchSource } from '@/core/search/sources/musicbrainz'
import { createTidalSearchSource } from '@/core/search/sources/tidal'

describe('search source catalog', () => {
  it('marks Spotify and TIDAL unavailable when not configured', () => {
    const sources = buildSearchSourceCatalog({
      hasSpotifyOAuth: false,
      hasTidalSearch: false,
    })

    expect(sources).toEqual([
      {
        id: 'spotify',
        label: 'Spotify',
        available: false,
        stability: 'stable',
        reason: 'search.spotifyNotConnected',
      },
      { id: 'deezer', label: 'Deezer', available: true, stability: 'stable' },
      { id: 'musicbrainz', label: 'MusicBrainz', available: true, stability: 'stable' },
      {
        id: 'tidal',
        label: 'TIDAL',
        available: false,
        stability: 'experimental',
        reason: 'search.tidalNotConfigured',
      },
      { id: 'bandcamp', label: 'Bandcamp', available: true, stability: 'experimental' },
    ])
  })

  it('marks TIDAL available once client credentials are configured', () => {
    const sources = buildSearchSourceCatalog({
      hasSpotifyOAuth: false,
      hasTidalSearch: true,
    })

    expect(sources).toContainEqual({
      id: 'tidal',
      label: 'TIDAL',
      available: true,
      stability: 'experimental',
    })
  })
})

describe('Deezer search source', () => {
  it('prioritizes close name matches and trims noisy results', async () => {
    const source = createDeezerSearchSource({
      getArtistTopTracks: async () => [],
      searchArtists: async () => [
        { id: 1, name: 'Head Radio', fans: 999_999, url: 'https://deezer.example/head-radio' },
        { id: 2, name: 'Radiohead', fans: 500_000, url: 'https://deezer.example/radiohead' },
        {
          id: 3,
          name: 'Radiohead Tribute Orchestra',
          fans: 800_000,
          url: 'https://deezer.example/tribute',
        },
        { id: 4, name: 'Radioheater', fans: 750_000, url: 'https://deezer.example/radioheater' },
      ],
      searchTracks: async () => [],
      testConnection: async () => ({ success: true, message: 'ok' }),
    })

    const results = await source.search('radiohead', 20)

    expect(results.map((result) => result.name)).toEqual([
      'Radiohead',
      'Radiohead Tribute Orchestra',
    ])
  })
})

describe('MusicBrainz search source', () => {
  it('keeps the exact artist first and drops low-relevance matches', async () => {
    const source = createMusicBrainzSearchSource({
      searchArtist: async () => ({
        artists: [
          { id: '1', name: 'Head Radio', score: 100 },
          { id: '2', name: 'Radiohead', score: 95, tags: [{ name: 'alternative', count: 9 }] },
          { id: '3', name: 'The Radiohead Project', score: 88 },
          { id: '4', name: 'Radioheater', score: 94 },
        ],
      }),
    })

    const results = await source.search('radiohead', 20)

    expect(results.map((result) => result.name)).toEqual(['Radiohead', 'The Radiohead Project'])
    expect(results[0]?.genres).toEqual(['alternative'])
  })

  it('caps broad MusicBrainz result sets to eight items', async () => {
    const source = createMusicBrainzSearchSource({
      searchArtist: async () => ({
        artists: Array.from({ length: 12 }, (_, index) => ({
          id: String(index + 1),
          name: `Muse Tribute ${index + 1}`,
          score: 95 - index,
        })).concat([{ id: 'exact', name: 'Muse', score: 100 }]),
      }),
    })

    const results = await source.search('muse', 20)

    expect(results).toHaveLength(8)
    expect(results[0]?.name).toBe('Muse')
  })
})

describe('TIDAL search source', () => {
  it('prioritizes close name matches and trims noisy results', async () => {
    const source = createTidalSearchSource({
      searchArtists: async () => [
        { id: 1, name: 'Head Radio', popularity: 99, url: 'https://tidal.example/head-radio' },
        { id: 2, name: 'Radiohead', popularity: 80, url: 'https://tidal.example/radiohead' },
        {
          id: 3,
          name: 'Radiohead Tribute Orchestra',
          popularity: 60,
          url: 'https://tidal.example/tribute',
        },
        { id: 4, name: 'Radioheater', popularity: 70, url: 'https://tidal.example/radioheater' },
      ],
      testConnection: async () => ({ success: true, message: 'ok' }),
    })

    const results = await source.search('radiohead', 20)

    expect(results.map((result) => result.name)).toEqual([
      'Radiohead',
      'Radiohead Tribute Orchestra',
    ])
  })

  it('maps TIDAL fields to the shared search result shape', async () => {
    const source = createTidalSearchSource({
      searchArtists: async () => [
        {
          id: 42,
          name: 'Radiohead',
          popularity: 88,
          url: 'https://tidal.example/radiohead',
          imageUrl: 'https://tidal.example/radiohead.jpg',
        },
      ],
      testConnection: async () => ({ success: true, message: 'ok' }),
    })

    const results = await source.search('radiohead', 20)

    expect(results).toEqual([
      {
        name: 'Radiohead',
        images: [{ url: 'https://tidal.example/radiohead.jpg', source: 'tidal' }],
        genres: [],
        popularity: 88,
        sourceId: 'tidal',
        sourceUrl: 'https://tidal.example/radiohead',
        externalId: '42',
      },
    ])
  })

  it('omits images when TIDAL has no artwork for a match', async () => {
    const source = createTidalSearchSource({
      searchArtists: async () => [
        { id: 7, name: 'Radiohead', popularity: 88, url: 'https://tidal.example/radiohead' },
      ],
      testConnection: async () => ({ success: true, message: 'ok' }),
    })

    const results = await source.search('radiohead', 20)

    expect(results[0]?.images).toEqual([])
    expect(results[0]?.externalId).toBe('7')
  })
})
