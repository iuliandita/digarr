// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createJellyfinClient } from '@/core/clients/jellyfin'

const mockGet = vi.fn()
const queueMocks = vi.hoisted(() => {
  const add = vi.fn((task: () => unknown) => task())
  return { add, create: vi.fn(() => ({ add })) }
})

vi.mock('@/core/clients/http', () => ({
  createHttpClient: vi.fn(() => ({
    get: mockGet,
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  })),
}))

vi.mock('@/core/clients/media-server-queue', () => ({
  createMediaServerQueue: queueMocks.create,
}))

beforeEach(() => {
  mockGet.mockReset()
  queueMocks.add.mockClear()
  queueMocks.create.mockClear()
})

describe('jellyfin media-server queue', () => {
  it('creates one queue per client instance', () => {
    createJellyfinClient('http://jf:8096', 'key', '00000000-0000-0000-0000-000000000001')
    createJellyfinClient('http://jf:8096', 'key', '00000000-0000-0000-0000-000000000002')

    expect(queueMocks.create).toHaveBeenCalledTimes(2)
  })
})

describe('jellyfin client.searchTracks()', () => {
  const USER = '00000000-0000-0000-0000-000000000001'

  it.each([
    [undefined, 25],
    [0, 0],
    [-2, 0],
    [200, 100],
    [2.8, 2],
  ])('scopes queued audio search with bounded limit %s', async (limit, expectedLimit) => {
    const client = createJellyfinClient('http://jf:8096', 'key', 'Listener', {
      libraryId: 'music & more',
    })
    mockGet.mockResolvedValueOnce([{ Id: USER, Name: 'Listener' }])
    mockGet.mockResolvedValue({
      Items: Array.from({ length: 101 }, (_, index) => ({
        Name: `Track ${index}`,
        Artists: ['AC/DC & Friends'],
        Path: `/music/track-${index}.flac`,
      })),
    })

    await expect(client.searchTracks('AC/DC & Friends', limit)).resolves.toHaveLength(expectedLimit)

    if (expectedLimit === 0) {
      expect(mockGet).not.toHaveBeenCalled()
      return
    }

    const url = new URL(mockGet.mock.calls[1]?.[0] as string, 'http://jf:8096')
    expect(url.pathname).toBe(`/Users/${USER}/Items`)
    expect(Object.fromEntries(url.searchParams)).toEqual({
      Artists: 'AC/DC & Friends',
      IncludeItemTypes: 'Audio',
      Recursive: 'true',
      Fields: 'Path',
      Limit: String(expectedLimit),
      ParentId: 'music & more',
    })
    expect(queueMocks.add).toHaveBeenCalledTimes(2)
  })

  it('maps real paths and matching credits, omits incomplete tracks and invalid durations', async () => {
    const client = createJellyfinClient('http://jf:8096', 'key', USER)
    mockGet.mockResolvedValueOnce({
      Items: [
        {
          Name: 'Duet',
          Artists: ['Guest', '  Bjo\u0308rk  '],
          AlbumArtist: 'Various Artists',
          Path: '/music/Bjork/Duet.flac',
          RunTimeTicks: 1_255_000_000,
        },
        { Name: 'Intro', Artists: ['Björk'], Path: 'D:\\music\\Intro.mp3', RunTimeTicks: 0 },
        {
          Name: 'No duration',
          ArtistItems: [{ Name: 'Björk' }],
          Path: '/music/track.flac',
          RunTimeTicks: -1,
        },
        {
          Name: 'Album credit',
          AlbumArtist: 'Björk',
          Path: '/music/album.flac',
          RunTimeTicks: Number.POSITIVE_INFINITY,
        },
        {
          Name: 'Other artist',
          Artists: ['Guest'],
          AlbumArtist: 'Björk',
          Path: '/music/guest.flac',
        },
        { Name: 'Missing path', Artists: ['Björk'], Id: 'not-a-path' },
        { Name: 'Empty path', Artists: ['Björk'], Path: ' ' },
        { Name: 'Remote', Artists: ['Björk'], Path: 'https://server/stream' },
        {
          Name: 'No artist',
          Artists: [null, 42],
          ArtistItems: [null, {}],
          Path: '/music/unknown.flac',
        },
        { Name: ' ', Artists: ['Björk'], Path: '/music/empty.flac' },
      ],
    })

    await expect(client.searchTracks('Björk')).resolves.toEqual([
      { name: 'Duet', artist: 'Bjo\u0308rk', path: '/music/Bjork/Duet.flac', duration: 125.5 },
      { name: 'Intro', artist: 'Björk', path: 'D:\\music\\Intro.mp3', duration: 0 },
      { name: 'No duration', artist: 'Björk', path: '/music/track.flac', duration: undefined },
      { name: 'Album credit', artist: 'Björk', path: '/music/album.flac', duration: undefined },
      { name: 'Other artist', artist: 'Guest', path: '/music/guest.flac', duration: undefined },
    ])
    expect(mockGet.mock.calls[0]?.[0]).not.toContain('ParentId=')
  })

  it.each([null, {}, { Items: null }, { Items: {} }, { Items: [null] }, { Items: [[]] }])(
    'rejects malformed track collection %j',
    async (response) => {
      mockGet.mockResolvedValueOnce(response)
      const client = createJellyfinClient('http://jf:8096', 'key', USER)
      await expect(client.searchTracks('Artist')).rejects.toThrow('invalid track collection')
    },
  )

  it('propagates provider failures', async () => {
    const invalidClient = createJellyfinClient('http://jf:8096', 'key', 'Listener')
    await expect(invalidClient.searchTracks(' ')).resolves.toEqual([])
    await expect(invalidClient.searchTracks('Artist', Number.NaN)).rejects.toThrow('must be finite')
    expect(mockGet).not.toHaveBeenCalled()
    mockGet.mockRejectedValueOnce(new Error('401 Unauthorized'))
    const client = createJellyfinClient('http://jf:8096', 'key', USER)
    await expect(client.searchTracks('Artist')).rejects.toThrow('401 Unauthorized')
  })
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
    mockGet.mockResolvedValueOnce({ Items: [] }) // /Users/{id}/Views
    mockGet.mockResolvedValueOnce({ Items: [], TotalRecordCount: 0 })
    mockGet.mockResolvedValueOnce({ Items: [], TotalRecordCount: 0 })

    await expect(client.testConnection()).resolves.toMatchObject({
      success: true,
      message: 'Connected to Jellyfin "Home Media" v10.9.0 - 0 top artist(s)',
    })

    expect(mockGet).toHaveBeenNthCalledWith(2, '/Users/00000000-0000-0000-0000-000000000001/Views')
    expect(mockGet).toHaveBeenNthCalledWith(
      3,
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

describe('jellyfin library selection', () => {
  const USER = '00000000-0000-0000-0000-000000000001'
  const VIEWS = {
    Items: [
      { Id: 'lib-music', Name: 'Music', CollectionType: 'music' },
      { Id: 'lib-books', Name: 'Audiobooks', CollectionType: 'books' },
      { Id: 'lib-music-2', Name: 'Kids Music', CollectionType: 'music' },
    ],
  }

  it('getAllArtists() pages through the /Artists endpoint when a library is configured', async () => {
    const client = createJellyfinClient('http://jf:8096', 'key', USER, {
      libraryId: 'lib-music',
    })
    mockGet.mockResolvedValueOnce({
      TotalRecordCount: 1,
      Items: [
        {
          Id: 'jf-1',
          Name: 'Bush',
          Genres: ['Rock'],
          ProviderIds: { MusicBrainzArtist: 'a74b1b7f-71a5-4011-9441-d0b5e4122711' },
        },
      ],
    })

    await expect(client.getAllArtists()).resolves.toEqual([
      { id: 'jf-1', name: 'Bush', mbid: 'a74b1b7f-71a5-4011-9441-d0b5e4122711', genres: ['Rock'] },
    ])
    const path = mockGet.mock.calls[0]?.[0] as string
    expect(path).toContain('/Artists?')
    expect(path).toContain('ParentId=lib-music')
    expect(path).toContain('Fields=Genres%2CProviderIds')
    expect(path).toContain('StartIndex=0')
  })

  it('testConnection() reports the selected library and all music libraries', async () => {
    const client = createJellyfinClient('http://jf:8096', 'key', USER, {
      libraryId: 'lib-music-2',
    })
    mockGet.mockResolvedValueOnce({ ServerName: 'Home Media', Version: '10.9.0' })
    mockGet.mockResolvedValueOnce(VIEWS)
    mockGet.mockResolvedValueOnce({ Items: [], TotalRecordCount: 0 })
    mockGet.mockResolvedValueOnce({ Items: [], TotalRecordCount: 0 })

    await expect(client.testConnection()).resolves.toMatchObject({
      success: true,
      message:
        'Connected to Jellyfin "Home Media" v10.9.0 - 0 top artist(s) - using library "Kids Music"',
      details: {
        libraryId: 'lib-music-2',
        libraries: [
          { id: 'lib-music', name: 'Music' },
          { id: 'lib-music-2', name: 'Kids Music' },
        ],
      },
    })
  })
})
