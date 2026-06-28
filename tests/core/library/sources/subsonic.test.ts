// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createSubsonicLibrarySource } from '@/core/library/sources/subsonic'

describe('subsonic LibrarySource', () => {
  it('reports correct id, mbidQuality, capabilities, and userId', () => {
    const client = { getAllArtists: vi.fn(), testConnection: vi.fn() }
    const source = createSubsonicLibrarySource(client as never, 7)
    expect(source.id).toBe('subsonic')
    expect(source.mbidQuality).toBe('low')
    expect(source.capabilities).toContain('listArtists')
    expect(source.capabilities).toContain('listAlbums')
    expect(source.userId).toBe(7)
  })

  it('listArtists maps getAllArtists to LibraryArtist (no mbid)', async () => {
    const client = {
      getAllArtists: vi.fn().mockResolvedValue([
        { id: '101', name: 'Bush' },
        { id: '102', name: 'Radiohead' },
      ]),
      testConnection: vi.fn(),
    }
    const source = createSubsonicLibrarySource(client as never, 7)
    const artists = await source.listArtists()
    expect(artists).toEqual([
      { sourceArtistId: '101', name: 'Bush', mbid: undefined },
      { sourceArtistId: '102', name: 'Radiohead', mbid: undefined },
    ])
  })

  it('testConnection delegates to underlying client', async () => {
    const client = {
      getAllArtists: vi.fn(),
      testConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
    }
    const source = createSubsonicLibrarySource(client as never, 7)
    const result = await source.testConnection()
    expect(result.success).toBe(true)
    expect(client.testConnection).toHaveBeenCalled()
  })

  it('listAlbums maps getAlbumsForArtist to LibraryAlbum rows', async () => {
    const client = {
      getAllArtists: vi.fn(),
      getAlbumsForArtist: vi.fn().mockResolvedValue([
        {
          id: 'alb-1',
          artistId: 'artist-1',
          title: 'Dummy',
          releaseYear: 1991,
        },
      ]),
      testConnection: vi.fn(),
    }
    const source = createSubsonicLibrarySource(client as never, 7)
    const albums = await source.listAlbums?.('artist-1')
    expect(albums).toEqual([
      {
        sourceAlbumId: 'alb-1',
        sourceArtistId: 'artist-1',
        title: 'Dummy',
        mbid: undefined,
        releaseYear: 1991,
        primaryType: 'Album',
      },
    ])
  })
})
