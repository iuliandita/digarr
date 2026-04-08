// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createJellyfinLibrarySource } from '@/core/library/sources/jellyfin'

describe('jellyfin LibrarySource', () => {
  it('reports correct id, mbidQuality, capabilities, and userId', () => {
    const client = { getAllArtists: vi.fn(), testConnection: vi.fn() }
    const source = createJellyfinLibrarySource(client as never, 9)
    expect(source.id).toBe('jellyfin')
    expect(source.mbidQuality).toBe('high')
    expect(source.capabilities).toContain('listArtists')
    expect(source.capabilities).toContain('listAlbums')
    expect(source.userId).toBe(9)
  })

  it('listArtists passes through MBIDs and genres', async () => {
    const client = {
      getAllArtists: vi.fn().mockResolvedValue([
        {
          id: 'jf-1',
          name: 'Bush',
          mbid: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
          genres: ['Rock'],
        },
        { id: 'jf-2', name: 'Radiohead', mbid: undefined, genres: [] },
      ]),
      testConnection: vi.fn(),
    }
    const source = createJellyfinLibrarySource(client as never, 9)
    const artists = await source.listArtists()
    expect(artists).toEqual([
      {
        sourceArtistId: 'jf-1',
        name: 'Bush',
        mbid: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
        genres: ['Rock'],
      },
      { sourceArtistId: 'jf-2', name: 'Radiohead', mbid: undefined, genres: [] },
    ])
  })

  it('testConnection delegates to underlying client', async () => {
    const client = {
      getAllArtists: vi.fn(),
      testConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
    }
    const source = createJellyfinLibrarySource(client as never, 9)
    const result = await source.testConnection()
    expect(result.success).toBe(true)
    expect(client.testConnection).toHaveBeenCalled()
  })

  it('listAlbums passes through Jellyfin album MBIDs', async () => {
    const client = {
      getAllArtists: vi.fn(),
      getAlbumsForArtist: vi.fn().mockResolvedValue([
        {
          id: 'jf-alb-1',
          artistId: 'jf-artist-1',
          title: 'Kid A',
          mbid: '11111111-1111-1111-1111-111111111111',
          releaseYear: 2000,
          primaryType: 'Album',
        },
      ]),
      testConnection: vi.fn(),
    }
    const source = createJellyfinLibrarySource(client as never, 9)
    const albums = await source.listAlbums?.('jf-artist-1')
    expect(albums).toEqual([
      {
        sourceAlbumId: 'jf-alb-1',
        sourceArtistId: 'jf-artist-1',
        title: 'Kid A',
        mbid: '11111111-1111-1111-1111-111111111111',
        releaseYear: 2000,
        primaryType: 'Album',
      },
    ])
  })

  it('listAlbums leaves mbid undefined when only MusicBrainzAlbum is present', async () => {
    const client = {
      getAllArtists: vi.fn(),
      getAlbumsForArtist: vi.fn().mockResolvedValue([
        {
          id: 'jf-alb-2',
          artistId: 'jf-artist-1',
          title: 'Amnesiac',
          mbid: undefined,
          releaseYear: 2001,
          primaryType: 'Album',
        },
      ]),
      testConnection: vi.fn(),
    }
    const source = createJellyfinLibrarySource(client as never, 9)
    const albums = await source.listAlbums?.('jf-artist-1')
    expect(albums).toEqual([
      {
        sourceAlbumId: 'jf-alb-2',
        sourceArtistId: 'jf-artist-1',
        title: 'Amnesiac',
        mbid: undefined,
        releaseYear: 2001,
        primaryType: 'Album',
      },
    ])
  })
})
