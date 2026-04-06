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
