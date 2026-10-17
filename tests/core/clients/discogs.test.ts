// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDiscogsClient } from '@/core/clients/discogs'

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

describe('discogs client genre mapping', () => {
  it('weights collection genres and styles by each artist release count', async () => {
    mockGet.mockResolvedValueOnce({
      releases: [
        {
          basic_information: {
            artists: [{ name: 'Radiohead', id: 1 }],
            genres: ['Rock'],
            styles: ['Alternative Rock'],
          },
        },
        {
          basic_information: {
            artists: [{ name: 'Radiohead', id: 1 }],
            genres: ['Rock'],
            styles: ['Art Rock'],
          },
        },
      ],
      pagination: { pages: 1, page: 1, items: 2 },
    })

    const client = createDiscogsClient('token', 'user')
    await expect(client.getCollectionArtists()).resolves.toEqual([
      {
        name: 'Radiohead',
        id: 1,
        count: 2,
        genres: ['Rock', 'Alternative Rock', 'Art Rock'],
      },
    ])
  })

  it('strips the numeric disambiguation suffix and encodes the username', async () => {
    mockGet.mockResolvedValueOnce({
      releases: [
        {
          basic_information: { artists: [{ name: 'Nirvana (2)', id: 7 }], genres: [], styles: [] },
        },
      ],
      pagination: { pages: 1, page: 1, items: 1 },
    })

    const client = createDiscogsClient('token', 'a b/c')
    const result = await client.getCollectionArtists()

    expect(result[0]?.name).toBe('Nirvana')
    expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('/users/a%20b%2Fc/'))
  })

  it('pages past three pages up to pagination.pages', async () => {
    for (let page = 1; page <= 5; page++) {
      mockGet.mockResolvedValueOnce({
        releases: [
          {
            basic_information: {
              artists: [{ name: `A${page}`, id: page }],
              genres: [],
              styles: [],
            },
          },
        ],
        pagination: { pages: 5, page, items: 5 },
      })
    }

    const client = createDiscogsClient('token', 'user')
    const result = await client.getCollectionArtists()

    expect(result).toHaveLength(5)
    expect(mockGet).toHaveBeenCalledTimes(5)
  })

  it('leaves wantlist artists without inferred genres', async () => {
    mockGet.mockResolvedValueOnce({
      wants: [{ basic_information: { artists: [{ name: 'Portishead', id: 2 }] } }],
      pagination: { pages: 1, page: 1, items: 1 },
    })

    const client = createDiscogsClient('token', 'user')
    await expect(client.getWantlistArtists()).resolves.toEqual([
      { name: 'Portishead', id: 2, count: 1, genres: [] },
    ])
  })
})
