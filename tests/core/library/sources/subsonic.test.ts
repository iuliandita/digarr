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
      getAllAlbums: vi.fn().mockResolvedValue([]),
      testConnection: vi.fn(),
    }
    const source = createSubsonicLibrarySource(client as never, 7)
    const artists = await source.listArtists()
    expect(artists).toEqual([
      { sourceArtistId: '101', name: 'Bush', mbid: undefined, knownAlbumTitles: [] },
      { sourceArtistId: '102', name: 'Radiohead', mbid: undefined, knownAlbumTitles: [] },
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
      getAllAlbums: vi.fn().mockResolvedValue([]),
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

describe('Subsonic artist album hints', () => {
  it('groups distinct titles by artistId and passes tagged MBIDs through', async () => {
    const mbid = 'a74b1b7f-71a5-4011-9441-d0b5e4122711'
    const client = {
      getAllArtists: vi.fn().mockResolvedValue([
        { id: '1', name: 'Bush', mbid },
        { id: '2', name: 'Other' },
        { id: '3', name: 'Empty' },
      ]),
      getAllAlbums: vi.fn().mockResolvedValue([
        { id: 'a', artistId: '1', title: 'One' },
        { id: 'b', artistId: '2', title: 'Two' },
        { id: 'c', artistId: '1', title: 'One' },
        { id: 'd', artistId: '1', title: 'Three' },
        { id: 'e', artistId: '1', title: ' ' },
        { id: 'f', artistId: 'missing', title: 'Orphan' },
      ]),
    }
    expect(await createSubsonicLibrarySource(client as never, 7).listArtists()).toEqual([
      { sourceArtistId: '1', name: 'Bush', mbid, knownAlbumTitles: ['One', 'Three'] },
      { sourceArtistId: '2', name: 'Other', mbid: undefined, knownAlbumTitles: ['Two'] },
      { sourceArtistId: '3', name: 'Empty', mbid: undefined, knownAlbumTitles: [] },
    ])
  })

  it.each([
    'network failure',
    'Subsonic album pagination did not advance',
    'Subsonic album pagination exceeded 200000 albums',
  ])('continues artist and album sync without hints after %s', async (failure) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const client = {
        getAllArtists: vi.fn().mockResolvedValue([{ id: '1', name: 'Bush' }]),
        getAllAlbums: vi.fn().mockRejectedValue(new Error(failure)),
        getAlbumsForArtist: vi.fn().mockResolvedValue([{ id: 'a', artistId: '1', title: 'One' }]),
      }
      const source = createSubsonicLibrarySource(client as never, 7)
      expect(await source.listArtists()).toEqual([
        { sourceArtistId: '1', name: 'Bush', mbid: undefined, knownAlbumTitles: [] },
      ])
      expect(await source.listAlbums?.('1')).toEqual([
        {
          sourceAlbumId: 'a',
          sourceArtistId: '1',
          title: 'One',
          mbid: undefined,
          releaseYear: undefined,
          primaryType: 'Album',
        },
      ])
      expect(warn).toHaveBeenCalledWith(`[library-subsonic] Album hints unavailable: ${failure}`)
    } finally {
      warn.mockRestore()
    }
  })

  it.each(['artists', 'albums'])('still propagates real %s fetch failures', async (failure) => {
    const client = {
      getAllArtists: vi.fn().mockRejectedValue(new Error('artist fetch failed')),
      getAllAlbums: vi.fn(),
      getAlbumsForArtist: vi.fn().mockRejectedValue(new Error('album fetch failed')),
    }
    const source = createSubsonicLibrarySource(client as never, 7)
    await expect(
      failure === 'artists' ? source.listArtists() : source.listAlbums?.('1'),
    ).rejects.toThrow(failure === 'artists' ? 'artist fetch failed' : 'album fetch failed')
    expect(client.getAllAlbums).not.toHaveBeenCalled()
  })
})
