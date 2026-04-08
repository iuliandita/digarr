// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createPlexLibrarySource } from '@/core/library/sources/plex'

describe('plex LibrarySource', () => {
  it('reports correct id, mbidQuality, capabilities, and userId', () => {
    const client = { getAllArtists: vi.fn(), testConnection: vi.fn() }
    const source = createPlexLibrarySource(client as never, 7)
    expect(source.id).toBe('plex')
    expect(source.mbidQuality).toBe('low')
    expect(source.capabilities).toContain('listArtists')
    expect(source.capabilities).toContain('listAlbums')
    expect(source.userId).toBe(7)
  })

  it('listArtists maps PlexLibraryArtist to LibraryArtist (no mbid)', async () => {
    const client = {
      getAllArtists: vi.fn().mockResolvedValue([
        { ratingKey: '101', name: 'Bush', genres: ['rock'] },
        { ratingKey: '102', name: 'Radiohead', genres: ['art rock'] },
      ]),
      testConnection: vi.fn(),
    }
    const source = createPlexLibrarySource(client as never, 7)
    const artists = await source.listArtists()
    expect(artists).toEqual([
      { sourceArtistId: '101', name: 'Bush', mbid: undefined, genres: ['rock'] },
      { sourceArtistId: '102', name: 'Radiohead', mbid: undefined, genres: ['art rock'] },
    ])
  })

  it('testConnection delegates to underlying client', async () => {
    const client = {
      getAllArtists: vi.fn(),
      testConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
    }
    const source = createPlexLibrarySource(client as never, 7)
    const result = await source.testConnection()
    expect(result.success).toBe(true)
    expect(client.testConnection).toHaveBeenCalled()
  })

  it('listAlbums maps Plex albums to LibraryAlbum rows', async () => {
    const client = {
      getAllArtists: vi.fn(),
      getAlbumsForArtist: vi.fn().mockResolvedValue([
        {
          ratingKey: 'alb-1',
          artistRatingKey: 'artist-1',
          title: 'Dummy',
          releaseYear: 1991,
          primaryType: 'Album',
        },
      ]),
      testConnection: vi.fn(),
    }
    const source = createPlexLibrarySource(client as never, 7)
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
