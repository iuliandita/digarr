// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createLidarrLibrarySource } from '@/core/library/sources/lidarr'

const mockArtists = [
  {
    id: 1,
    artistName: 'Radiohead',
    foreignArtistId: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
    qualityProfileId: 1,
    rootFolderPath: '/music',
    monitored: true,
    status: 'continuing',
    genres: ['rock', 'art rock'],
  },
  {
    id: 2,
    artistName: 'Portishead',
    foreignArtistId: '8f6bd1e4-fbe1-4f50-aa9b-94c450ec0a11',
    qualityProfileId: 1,
    rootFolderPath: '/music',
    monitored: true,
    status: 'continuing',
    genres: ['trip hop'],
  },
]

describe('lidarr LibrarySource', () => {
  it('reports correct id, mbidQuality, and capabilities', () => {
    const client = { getArtists: vi.fn(), testConnection: vi.fn() }
    const source = createLidarrLibrarySource(client as never)
    expect(source.id).toBe('lidarr')
    expect(source.mbidQuality).toBe('high')
    expect(source.capabilities).toContain('listArtists')
    expect(source.capabilities).toContain('listAlbums')
    expect(source.userId).toBeNull()
  })

  it('listArtists maps Lidarr artists to LibraryArtist', async () => {
    const client = {
      getArtists: vi.fn().mockResolvedValue(mockArtists),
      testConnection: vi.fn(),
    }
    const source = createLidarrLibrarySource(client as never)
    const artists = await source.listArtists()
    expect(artists).toEqual([
      {
        sourceArtistId: '1',
        name: 'Radiohead',
        mbid: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
        genres: ['rock', 'art rock'],
      },
      {
        sourceArtistId: '2',
        name: 'Portishead',
        mbid: '8f6bd1e4-fbe1-4f50-aa9b-94c450ec0a11',
        genres: ['trip hop'],
      },
    ])
  })

  it('listArtists defaults missing genres to empty array', async () => {
    const client = {
      getArtists: vi.fn().mockResolvedValue([{ ...mockArtists[0], genres: undefined }]),
      testConnection: vi.fn(),
    }
    const source = createLidarrLibrarySource(client as never)
    const artists = await source.listArtists()
    expect(artists[0]?.genres).toEqual([])
  })

  it('testConnection delegates to underlying client', async () => {
    const client = {
      getArtists: vi.fn(),
      testConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
    }
    const source = createLidarrLibrarySource(client as never)
    const result = await source.testConnection()
    expect(result.success).toBe(true)
    expect(client.testConnection).toHaveBeenCalled()
  })

  it('listAlbums maps Lidarr albums to LibraryAlbum rows', async () => {
    const client = {
      getArtists: vi.fn(),
      getAlbums: vi.fn().mockResolvedValue([
        {
          id: 10,
          title: 'OK Computer',
          artistId: 1,
          foreignAlbumId: '11111111-1111-1111-1111-111111111111',
          monitored: true,
          albumType: 'Album',
        },
      ]),
      testConnection: vi.fn(),
    }
    const source = createLidarrLibrarySource(client as never)
    const albums = await source.listAlbums?.('1')
    expect(albums).toEqual([
      {
        sourceAlbumId: '10',
        sourceArtistId: '1',
        title: 'OK Computer',
        mbid: '11111111-1111-1111-1111-111111111111',
        primaryType: 'Album',
      },
    ])
  })

  it('listAlbums preserves Lidarr EP primary type', async () => {
    const client = {
      getArtists: vi.fn(),
      getAlbums: vi.fn().mockResolvedValue([
        {
          id: 11,
          title: 'Kid A Mnesia',
          artistId: 1,
          foreignAlbumId: '22222222-2222-2222-2222-222222222222',
          monitored: true,
          albumType: 'EP',
        },
      ]),
      testConnection: vi.fn(),
    }
    const source = createLidarrLibrarySource(client as never)
    const albums = await source.listAlbums?.('1')
    expect(albums).toEqual([
      {
        sourceAlbumId: '11',
        sourceArtistId: '1',
        title: 'Kid A Mnesia',
        mbid: '22222222-2222-2222-2222-222222222222',
        primaryType: 'EP',
      },
    ])
  })
})
