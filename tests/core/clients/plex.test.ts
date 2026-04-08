// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPlexClient } from '@/core/clients/plex'

const mockGet = vi.fn()

vi.mock('@/core/clients/http', () => ({
  createHttpClient: vi.fn(() => ({
    get: mockGet,
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  })),
}))

beforeEach(() => {
  mockGet.mockReset()
})

const TEST_URL = 'http://plex.local:32400'
const TEST_TOKEN = 'test-plex-token'

describe('plex client.getAllArtists()', () => {
  it('paginates through the music library', async () => {
    // sections lookup
    mockGet.mockResolvedValueOnce({
      MediaContainer: {
        Directory: [{ key: '1', type: 'artist', title: 'Music' }],
      },
    })
    // page 1: 2 of 3 artists
    mockGet.mockResolvedValueOnce({
      MediaContainer: {
        totalSize: 3,
        Metadata: [
          { ratingKey: '101', title: 'Bush', Genre: [{ tag: 'rock' }] },
          { ratingKey: '102', title: 'Portishead', Genre: [{ tag: 'trip hop' }] },
        ],
      },
    })
    // page 2: remaining 1 artist
    mockGet.mockResolvedValueOnce({
      MediaContainer: {
        totalSize: 3,
        Metadata: [{ ratingKey: '103', title: 'Radiohead', Genre: [{ tag: 'art rock' }] }],
      },
    })

    const client = createPlexClient(TEST_URL, TEST_TOKEN)
    const artists = await client.getAllArtists({ pageSize: 2 })

    expect(artists).toEqual([
      { ratingKey: '101', name: 'Bush', genres: ['rock'] },
      { ratingKey: '102', name: 'Portishead', genres: ['trip hop'] },
      { ratingKey: '103', name: 'Radiohead', genres: ['art rock'] },
    ])
  })

  it('returns empty array when library is empty', async () => {
    // sections lookup
    mockGet.mockResolvedValueOnce({
      MediaContainer: {
        Directory: [{ key: '1', type: 'artist', title: 'Music' }],
      },
    })
    // empty page
    mockGet.mockResolvedValueOnce({
      MediaContainer: {
        totalSize: 0,
        Metadata: [],
      },
    })

    const client = createPlexClient(TEST_URL, TEST_TOKEN)
    const artists = await client.getAllArtists({ pageSize: 100 })

    expect(artists).toEqual([])
  })
})

describe('plex client.getAlbumsForArtist()', () => {
  it('includes a final partial page even when totalSize is missing', async () => {
    const client = createPlexClient(TEST_URL, TEST_TOKEN)

    mockGet.mockResolvedValueOnce({
      MediaContainer: {
        Metadata: [
          {
            ratingKey: 'alb-final',
            parentRatingKey: 'artist-1',
            title: 'A Moon Shaped Pool',
            year: 2016,
          },
        ],
      },
    })

    const albums = await client.getAlbumsForArtist('artist-1')

    expect(albums).toEqual([
      {
        ratingKey: 'alb-final',
        artistRatingKey: 'artist-1',
        title: 'A Moon Shaped Pool',
        releaseYear: 2016,
        primaryType: 'Album',
      },
    ])
  })

  it('paginates through the album library', async () => {
    const client = createPlexClient(TEST_URL, TEST_TOKEN)

    // first page of 5 albums
    mockGet.mockResolvedValueOnce({
      MediaContainer: {
        totalSize: 5,
        Metadata: [
          { ratingKey: 'alb-1', parentRatingKey: 'artist-1', title: 'Kid A', year: 2000 },
          { ratingKey: 'alb-2', parentRatingKey: 'artist-1', title: 'Amnesiac', year: 2001 },
        ],
      },
    })
    // second page omits totalSize, but more albums remain
    mockGet.mockResolvedValueOnce({
      MediaContainer: {
        Metadata: [
          {
            ratingKey: 'alb-3',
            parentRatingKey: 'artist-1',
            title: 'Hail to the Thief',
            year: 2003,
          },
          { ratingKey: 'alb-4', parentRatingKey: 'artist-1', title: 'In Rainbows', year: 2007 },
        ],
      },
    })
    // third page: final album
    mockGet.mockResolvedValueOnce({
      MediaContainer: {
        Metadata: [
          {
            ratingKey: 'alb-5',
            parentRatingKey: 'artist-1',
            title: 'The King of Limbs',
            year: 2011,
          },
        ],
      },
    })

    const albums = await client.getAlbumsForArtist('artist-1')

    expect(albums).toEqual([
      {
        ratingKey: 'alb-1',
        artistRatingKey: 'artist-1',
        title: 'Kid A',
        releaseYear: 2000,
        primaryType: 'Album',
      },
      {
        ratingKey: 'alb-2',
        artistRatingKey: 'artist-1',
        title: 'Amnesiac',
        releaseYear: 2001,
        primaryType: 'Album',
      },
      {
        ratingKey: 'alb-3',
        artistRatingKey: 'artist-1',
        title: 'Hail to the Thief',
        releaseYear: 2003,
        primaryType: 'Album',
      },
      {
        ratingKey: 'alb-4',
        artistRatingKey: 'artist-1',
        title: 'In Rainbows',
        releaseYear: 2007,
        primaryType: 'Album',
      },
      {
        ratingKey: 'alb-5',
        artistRatingKey: 'artist-1',
        title: 'The King of Limbs',
        releaseYear: 2011,
        primaryType: 'Album',
      },
    ])
  })
})
