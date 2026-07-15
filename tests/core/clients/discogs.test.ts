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
