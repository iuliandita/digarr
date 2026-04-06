// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createJellyfinClient } from '@/core/clients/jellyfin'

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

describe('jellyfin client.getAllArtists()', () => {
  it('paginates and extracts MBIDs from ProviderIds', async () => {
    // Pass a UUID so getUserId() short-circuits without an extra mockGet call
    const client = createJellyfinClient(
      'http://jf:8096',
      'test-api-key',
      '00000000-0000-0000-0000-000000000001',
    )

    mockGet.mockResolvedValueOnce({
      TotalRecordCount: 4,
      Items: [
        {
          Id: 'jf-1',
          Name: 'Bush',
          Genres: ['Rock'],
          ProviderIds: { MusicBrainzArtist: 'a74b1b7f-71a5-4011-9441-d0b5e4122711' },
        },
        {
          Id: 'jf-2',
          Name: 'Radiohead',
          Genres: ['Art Rock'],
          ProviderIds: {},
        },
      ],
    })
    mockGet.mockResolvedValueOnce({
      TotalRecordCount: 4,
      Items: [
        { Id: 'jf-3', Name: 'Portishead', Genres: ['Trip Hop'] },
        { Id: 'jf-4', Name: 'EmptyMBID', Genres: [], ProviderIds: { MusicBrainzArtist: '' } },
      ],
    })

    const artists = await client.getAllArtists({ pageSize: 2 })

    expect(artists).toEqual([
      { id: 'jf-1', name: 'Bush', mbid: 'a74b1b7f-71a5-4011-9441-d0b5e4122711', genres: ['Rock'] },
      { id: 'jf-2', name: 'Radiohead', mbid: undefined, genres: ['Art Rock'] },
      { id: 'jf-3', name: 'Portishead', mbid: undefined, genres: ['Trip Hop'] },
      { id: 'jf-4', name: 'EmptyMBID', mbid: undefined, genres: [] },
    ])
  })

  it('returns empty array when library is empty', async () => {
    const client = createJellyfinClient(
      'http://jf:8096',
      'test-api-key',
      '00000000-0000-0000-0000-000000000001',
    )

    mockGet.mockResolvedValueOnce({ TotalRecordCount: 0, Items: [] })

    const artists = await client.getAllArtists()
    expect(artists).toEqual([])
  })
})
