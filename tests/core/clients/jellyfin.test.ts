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

describe('jellyfin client.getAlbumsForArtist()', () => {
  it('paginates through multiple album pages', async () => {
    const client = createJellyfinClient(
      'http://jf:8096',
      'test-api-key',
      '00000000-0000-0000-0000-000000000001',
    )

    mockGet.mockResolvedValueOnce({
      TotalRecordCount: 3,
      Items: [
        {
          Id: 'jf-alb-1',
          Name: 'Kid A',
          ProductionYear: 2000,
          ProviderIds: {
            MusicBrainzReleaseGroup: '11111111-1111-1111-1111-111111111111',
          },
        },
        {
          Id: 'jf-alb-2',
          Name: 'Amnesiac',
          ProductionYear: 2001,
          ProviderIds: {
            MusicBrainzReleaseGroup: '22222222-2222-2222-2222-222222222222',
          },
        },
      ],
    })
    mockGet.mockResolvedValueOnce({
      TotalRecordCount: 3,
      Items: [
        {
          Id: 'jf-alb-3',
          Name: 'Hail to the Thief',
          ProductionYear: 2003,
          ProviderIds: {
            MusicBrainzReleaseGroup: '33333333-3333-3333-3333-333333333333',
          },
        },
      ],
    })

    const albums = await client.getAlbumsForArtist('jf-artist-1')

    expect(albums).toEqual([
      {
        id: 'jf-alb-1',
        artistId: 'jf-artist-1',
        title: 'Kid A',
        mbid: '11111111-1111-1111-1111-111111111111',
        releaseYear: 2000,
        primaryType: 'Album',
      },
      {
        id: 'jf-alb-2',
        artistId: 'jf-artist-1',
        title: 'Amnesiac',
        mbid: '22222222-2222-2222-2222-222222222222',
        releaseYear: 2001,
        primaryType: 'Album',
      },
      {
        id: 'jf-alb-3',
        artistId: 'jf-artist-1',
        title: 'Hail to the Thief',
        mbid: '33333333-3333-3333-3333-333333333333',
        releaseYear: 2003,
        primaryType: 'Album',
      },
    ])
  })

  it('prefers MusicBrainzReleaseGroup over MusicBrainzAlbum', async () => {
    const client = createJellyfinClient(
      'http://jf:8096',
      'test-api-key',
      '00000000-0000-0000-0000-000000000001',
    )

    mockGet.mockResolvedValueOnce({
      Items: [
        {
          Id: 'jf-alb-1',
          Name: 'Kid A',
          ProductionYear: 2000,
          ProviderIds: {
            MusicBrainzReleaseGroup: '11111111-1111-1111-1111-111111111111',
            MusicBrainzAlbum: '22222222-2222-2222-2222-222222222222',
          },
        },
      ],
    })

    const albums = await client.getAlbumsForArtist('jf-artist-1')

    expect(albums).toEqual([
      {
        id: 'jf-alb-1',
        artistId: 'jf-artist-1',
        title: 'Kid A',
        mbid: '11111111-1111-1111-1111-111111111111',
        releaseYear: 2000,
        primaryType: 'Album',
      },
    ])
  })

  it('does not fall back to MusicBrainzAlbum when release-group id is missing', async () => {
    const client = createJellyfinClient(
      'http://jf:8096',
      'test-api-key',
      '00000000-0000-0000-0000-000000000001',
    )

    mockGet.mockResolvedValueOnce({
      Items: [
        {
          Id: 'jf-alb-2',
          Name: 'Amnesiac',
          ProductionYear: 2001,
          ProviderIds: {
            MusicBrainzAlbum: '22222222-2222-2222-2222-222222222222',
          },
        },
      ],
    })

    const albums = await client.getAlbumsForArtist('jf-artist-1')

    expect(albums).toEqual([
      {
        id: 'jf-alb-2',
        artistId: 'jf-artist-1',
        title: 'Amnesiac',
        mbid: undefined,
        releaseYear: 2001,
        primaryType: 'Album',
      },
    ])
  })
})

describe('jellyfin client.testConnection()', () => {
  it('validates the configured user scope during connection tests', async () => {
    const client = createJellyfinClient(
      'http://jf:8096',
      'test-api-key',
      '00000000-0000-0000-0000-000000000001',
    )

    mockGet.mockResolvedValueOnce({ ServerName: 'Home Media', Version: '10.9.0' })
    mockGet.mockResolvedValueOnce({ Items: [], TotalRecordCount: 0 })
    mockGet.mockResolvedValueOnce({ Items: [], TotalRecordCount: 0 })

    await expect(client.testConnection()).resolves.toMatchObject({
      success: true,
      message: 'Connected to Jellyfin "Home Media" v10.9.0 -- 0 top artist(s)',
    })

    expect(mockGet).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/Users/00000000-0000-0000-0000-000000000001/Items?'),
    )
  })

  it('fails connection tests when the configured user id cannot access library items', async () => {
    const client = createJellyfinClient(
      'http://jf:8096',
      'test-api-key',
      '00000000-0000-0000-0000-000000000001',
    )

    mockGet.mockResolvedValueOnce({ ServerName: 'Home Media', Version: '10.9.0' })
    mockGet.mockRejectedValueOnce(new Error('404 User not found'))

    await expect(client.testConnection()).resolves.toMatchObject({
      success: false,
    })
  })
})
