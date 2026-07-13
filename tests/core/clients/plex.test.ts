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

describe('plex client.getTopArtists()', () => {
  it('maps genres already present in the top-artist response', async () => {
    mockGet.mockResolvedValueOnce({
      MediaContainer: {
        Metadata: [
          {
            ratingKey: '101',
            title: 'Portishead',
            viewCount: 12,
            Genre: [{ tag: 'trip hop' }, { tag: 'electronic' }],
          },
        ],
      },
    })

    const client = createPlexClient(TEST_URL, TEST_TOKEN, { sectionId: '1' })
    await expect(client.getTopArtists(10)).resolves.toEqual([
      {
        ratingKey: '101',
        name: 'Portishead',
        viewCount: 12,
        genres: ['trip hop', 'electronic'],
      },
    ])
  })
})

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

describe('plex library section selection', () => {
  const TWO_SECTIONS = {
    MediaContainer: {
      Directory: [
        { key: '3', type: 'artist', title: 'Audiobooks' },
        { key: '5', type: 'artist', title: 'Music' },
        { key: '7', type: 'movie', title: 'Movies' },
      ],
    },
  }

  it('getMusicSections returns only artist-type sections', async () => {
    mockGet.mockResolvedValueOnce(TWO_SECTIONS)
    const client = createPlexClient(TEST_URL, TEST_TOKEN)
    const sections = await client.getMusicSections()
    expect(sections).toEqual([
      { key: '3', title: 'Audiobooks' },
      { key: '5', title: 'Music' },
    ])
  })

  it('uses the configured section without hitting /library/sections', async () => {
    mockGet.mockResolvedValueOnce({
      MediaContainer: {
        totalSize: 1,
        Metadata: [{ ratingKey: '201', title: 'Radiohead', Genre: [] }],
      },
    })
    const client = createPlexClient(TEST_URL, TEST_TOKEN, { sectionId: '5' })
    const artists = await client.getAllArtists()
    expect(artists).toHaveLength(1)
    expect(mockGet).toHaveBeenCalledTimes(1)
    expect(mockGet.mock.calls[0]?.[0]).toContain('/library/sections/5/all')
  })

  it('auto-picks the first artist section when none is configured', async () => {
    mockGet.mockResolvedValueOnce(TWO_SECTIONS)
    const client = createPlexClient(TEST_URL, TEST_TOKEN)
    await expect(client.getMusicSectionId()).resolves.toBe('3')
  })

  it('testConnection reports the selected library and all music sections', async () => {
    mockGet.mockResolvedValueOnce(TWO_SECTIONS)
    const client = createPlexClient(TEST_URL, TEST_TOKEN, { sectionId: '5' })
    const result = await client.testConnection()
    expect(result.success).toBe(true)
    expect(result.message).toContain('"Music"')
    expect(result.details).toEqual({
      sectionId: '5',
      sections: [
        { key: '3', title: 'Audiobooks' },
        { key: '5', title: 'Music' },
      ],
    })
  })

  it('testConnection fails when the configured section no longer exists', async () => {
    mockGet.mockResolvedValueOnce(TWO_SECTIONS)
    const client = createPlexClient(TEST_URL, TEST_TOKEN, { sectionId: '99' })
    const result = await client.testConnection()
    expect(result.success).toBe(false)
    expect(result.message).toContain('99')
    expect(result.message).toContain('Music (5)')
  })

  it('testConnection fails when no music sections exist', async () => {
    mockGet.mockResolvedValueOnce({
      MediaContainer: { Directory: [{ key: '7', type: 'movie', title: 'Movies' }] },
    })
    const client = createPlexClient(TEST_URL, TEST_TOKEN)
    const result = await client.testConnection()
    expect(result.success).toBe(false)
    expect(result.message).toContain('No music library section')
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
