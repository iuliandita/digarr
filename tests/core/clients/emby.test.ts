// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmbyClient } from '@/core/clients/emby'

const queueMocks = vi.hoisted(() => {
  const add = vi.fn((task: () => unknown) => task())
  return { add, create: vi.fn(() => ({ add })) }
})

vi.mock('@/core/clients/media-server-queue', () => ({
  createMediaServerQueue: queueMocks.create,
}))

describe('createEmbyClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    queueMocks.add.mockClear()
    queueMocks.create.mockClear()
  })

  it('creates one media-server queue per client instance', () => {
    createEmbyClient('http://emby:8096', 'key', 'user-1')
    createEmbyClient('http://emby:8096', 'key', 'user-2')

    expect(queueMocks.create).toHaveBeenCalledTimes(2)
  })

  it('maps top artists from the Emby items endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            Items: [
              {
                Id: 'a1',
                Name: 'Boards of Canada',
                Genres: ['IDM', 'Ambient'],
                ProviderIds: { MusicBrainzArtist: '0743b15a-3c32-48c8-ad58-cb325350befa' },
                UserData: { PlayCount: 12, IsFavorite: true },
              },
            ],
            TotalRecordCount: 1,
          }),
      }),
    )

    const client = createEmbyClient('http://emby:8096', 'key', 'user-1')
    await expect(client.getTopArtists(10)).resolves.toEqual([
      {
        id: 'a1',
        name: 'Boards of Canada',
        mbid: '0743b15a-3c32-48c8-ad58-cb325350befa',
        genres: ['IDM', 'Ambient'],
        playCount: 12,
        isFavorite: true,
      },
    ])
    const url = vi.mocked(fetch).mock.calls[0]?.[0] as string
    expect(url).toContain('Fields=UserData%2CGenres%2CProviderIds')
  })

  it('passes through MusicBrainz artist ids for full-library artist sync', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            Items: [
              {
                Id: 'artist-1',
                Name: 'Radiohead',
                Genres: ['alternative'],
                ProviderIds: { MusicBrainzArtist: 'a74b1b7f-71a5-4011-9441-d0b5e4122711' },
              },
            ],
            TotalRecordCount: 1,
          }),
      }),
    )

    const client = createEmbyClient('http://emby:8096', 'key', 'user-1')
    await expect(client.getAllArtists()).resolves.toEqual([
      {
        id: 'artist-1',
        name: 'Radiohead',
        mbid: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
        genres: ['alternative'],
      },
    ])
  })

  it('paginates all artists and retains the configured library on each page', async () => {
    const artists = Array.from({ length: 201 }, (_, index) => ({
      Id: `artist-${index + 1}`,
      Name: `Artist ${index + 1}`,
      Genres: [],
    }))
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        const startIndex = Number(new URL(url).searchParams.get('StartIndex'))
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              Items: artists.slice(startIndex, startIndex + 200),
              TotalRecordCount: artists.length,
            }),
        })
      }),
    )

    const client = createEmbyClient('http://emby:8096', 'key', 'user-1', {
      libraryId: 'lib-music',
    })
    const result = await client.getAllArtists()

    expect(result).toHaveLength(201)
    expect(result[200]).toMatchObject({ id: 'artist-201', name: 'Artist 201' })
    const urls = vi.mocked(fetch).mock.calls.map(([url]) => url as string)
    expect(urls).toHaveLength(2)
    for (const url of urls) {
      expect(url).toContain('/Artists?')
      expect(url).toContain('ParentId=lib-music')
    }
    expect(urls[0]).toContain('StartIndex=0')
    expect(urls[1]).toContain('StartIndex=200')
  })

  it('paginates all albums for an artist', async () => {
    const albums = Array.from({ length: 201 }, (_, index) => ({
      Id: `album-${index + 1}`,
      Name: `Album ${index + 1}`,
      ProductionYear: 2000 + index,
    }))
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        const startIndex = Number(new URL(url).searchParams.get('StartIndex'))
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              Items: albums.slice(startIndex, startIndex + 200),
              TotalRecordCount: albums.length,
            }),
        })
      }),
    )

    const client = createEmbyClient('http://emby:8096', 'key', 'user-1')
    const result = await client.getAlbumsForArtist('artist-1')

    expect(result).toHaveLength(201)
    expect(result[200]).toMatchObject({ id: 'album-201', artistId: 'artist-1' })
    const urls = vi.mocked(fetch).mock.calls.map(([url]) => url as string)
    expect(urls).toHaveLength(2)
    expect(urls[0]).toContain('StartIndex=0')
    expect(urls[1]).toContain('StartIndex=200')
  })

  it('rejects totals larger than the pagination limit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ Items: [], TotalRecordCount: 200001 }),
      }),
    )

    const client = createEmbyClient('http://emby:8096', 'key', 'user-1')
    await expect(client.getAllArtists()).rejects.toThrow(
      'TotalRecordCount exceeds the 200000 item limit',
    )
  })

  it('fails instead of returning a partial result after 1000 short pages', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          Items: [{ Id: 'artist-1', Name: 'Artist', Genres: [] }],
          TotalRecordCount: 1001,
        }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const client = createEmbyClient('http://emby:8096', 'key', 'user-1')
    await expect(client.getAllArtists()).rejects.toThrow(
      'Emby artist pagination exceeded 1000 pages',
    )
    expect(fetchMock).toHaveBeenCalledTimes(1000)
  })

  it.each([-1, 1.5, '201', null])('rejects invalid total %j', async (total) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ Items: [], TotalRecordCount: total }),
      }),
    )

    const client = createEmbyClient('http://emby:8096', 'key', 'user-1')
    await expect(client.getAlbumsForArtist('artist-1')).rejects.toThrow(
      'Emby returned an invalid TotalRecordCount',
    )
  })

  it('stops on missing total counts and empty pages', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ Items: [{ Id: 'artist-1', Name: 'Artist', Genres: [] }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ Items: [] }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const client = createEmbyClient('http://emby:8096', 'key', 'user-1')
    await expect(client.getAllArtists()).resolves.toHaveLength(1)
    await expect(client.getAlbumsForArtist('artist-1')).resolves.toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('returns a friendly connection message from /System/Info', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ServerName: 'My Emby', Version: '4.9.0.1' }),
      }),
    )

    const client = createEmbyClient('http://emby:8096', 'key', 'user-1')
    await expect(client.testConnection()).resolves.toMatchObject({
      success: true,
      message: 'Connected to Emby "My Emby" v4.9.0.1',
    })
  })

  it('validates user-scoped access during connection tests when a user id is configured', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ ServerName: 'My Emby', Version: '4.9.0.1' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ Items: [] }), // /Users/{id}/Views
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ Items: [] }),
        }),
    )

    const client = createEmbyClient('http://emby:8096', 'key', 'user-1')
    await expect(client.testConnection()).resolves.toMatchObject({
      success: true,
      message: 'Connected to Emby "My Emby" v4.9.0.1',
    })

    const fetchMock = vi.mocked(fetch)
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/Users/user-1/Views'),
      expect.anything(),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('/Users/user-1/Items?'),
      expect.anything(),
    )
  })

  it('fails connection tests when the configured user id cannot access library items', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ ServerName: 'My Emby', Version: '4.9.0.1' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          text: async () => 'User not found',
        }),
    )

    const client = createEmbyClient('http://emby:8096', 'key', 'missing-user')
    await expect(client.testConnection()).resolves.toMatchObject({
      success: false,
    })
  })
})

describe('emby library selection', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  const VIEWS = JSON.stringify({
    Items: [
      { Id: 'lib-music', Name: 'Music', CollectionType: 'music' },
      { Id: 'lib-books', Name: 'Audiobooks', CollectionType: 'books' },
      { Id: 'lib-music-2', Name: 'Lossless', CollectionType: 'music' },
    ],
  })

  function jsonResponse(body: string) {
    return { ok: true, status: 200, text: async () => body }
  }

  it('getMusicLibraries() returns only music-type views', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(VIEWS)))

    const client = createEmbyClient('http://emby:8096', 'key', 'user-1')
    await expect(client.getMusicLibraries()).resolves.toEqual([
      { id: 'lib-music', name: 'Music' },
      { id: 'lib-music-2', name: 'Lossless' },
    ])
  })

  it('getTopArtists() uses the /Artists endpoint scoped by ParentId when a library is configured', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          JSON.stringify({
            Items: [
              {
                Id: 'a1',
                Name: 'Aphex Twin',
                Genres: ['Electronic'],
                ProviderIds: { MusicBrainzArtist: 'f229e6d8-c66f-4e9f-a972-a7b6a1f47f49' },
                UserData: { PlayCount: 3 },
              },
            ],
          }),
        ),
      ),
    )

    const client = createEmbyClient('http://emby:8096', 'key', 'user-1', {
      libraryId: 'lib-music-2',
    })
    await expect(client.getTopArtists(10)).resolves.toEqual([
      {
        id: 'a1',
        name: 'Aphex Twin',
        mbid: 'f229e6d8-c66f-4e9f-a972-a7b6a1f47f49',
        genres: ['Electronic'],
        playCount: 3,
        isFavorite: false,
      },
    ])
    const url = vi.mocked(fetch).mock.calls[0]?.[0] as string
    expect(url).toContain('/Artists?')
    expect(url).toContain('ParentId=lib-music-2')
    expect(url).toContain('UserId=user-1')
    expect(url).toContain('Fields=UserData%2CGenres%2CProviderIds')
  })

  it('getTopArtists() keeps the unscoped Items query when no library is configured', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(JSON.stringify({ Items: [] }))))

    const client = createEmbyClient('http://emby:8096', 'key', 'user-1')
    await client.getTopArtists(10)
    const url = vi.mocked(fetch).mock.calls[0]?.[0] as string
    expect(url).toContain('/Users/user-1/Items?')
    expect(url).toContain('IncludeItemTypes=MusicArtist')
    expect(url).not.toContain('ParentId=')
  })

  it('getAllArtists() and getFavoriteArtists() scope through the /Artists endpoint when a library is configured', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(JSON.stringify({ Items: [] }))))

    const client = createEmbyClient('http://emby:8096', 'key', 'user-1', {
      libraryId: 'lib-music-2',
    })
    await client.getAllArtists()
    await client.getFavoriteArtists(10)

    const allArtistsUrl = vi.mocked(fetch).mock.calls[0]?.[0] as string
    expect(allArtistsUrl).toContain('/Artists?')
    expect(allArtistsUrl).toContain('ParentId=lib-music-2')
    expect(allArtistsUrl).toContain('Fields=Genres%2CProviderIds')

    const favoritesUrl = vi.mocked(fetch).mock.calls[1]?.[0] as string
    expect(favoritesUrl).toContain('/Artists?')
    expect(favoritesUrl).toContain('ParentId=lib-music-2')
    expect(favoritesUrl).toContain('IsFavorite=true')
  })

  it('getRecentlyPlayed() scopes the Audio query with ParentId when a library is configured', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(JSON.stringify({ Items: [] }))))

    const client = createEmbyClient('http://emby:8096', 'key', 'user-1', {
      libraryId: 'lib-music',
    })
    await client.getRecentlyPlayed(10)
    const url = vi.mocked(fetch).mock.calls[0]?.[0] as string
    expect(url).toContain('/Users/user-1/Items?')
    expect(url).toContain('ParentId=lib-music')
  })

  it('testConnection() reports the selected library and all music libraries', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse(JSON.stringify({ ServerName: 'My Emby', Version: '4.9.0.1' })),
        )
        .mockResolvedValueOnce(jsonResponse(VIEWS))
        .mockResolvedValueOnce(jsonResponse(JSON.stringify({ Items: [] }))),
    )

    const client = createEmbyClient('http://emby:8096', 'key', 'user-1', {
      libraryId: 'lib-music-2',
    })
    await expect(client.testConnection()).resolves.toMatchObject({
      success: true,
      message: 'Connected to Emby "My Emby" v4.9.0.1 - using library "Lossless"',
      details: {
        libraryId: 'lib-music-2',
        libraries: [
          { id: 'lib-music', name: 'Music' },
          { id: 'lib-music-2', name: 'Lossless' },
        ],
      },
    })
    const audioProbeUrl = vi.mocked(fetch).mock.calls[2]?.[0] as string
    expect(audioProbeUrl).toContain('ParentId=lib-music-2')
  })

  it('testConnection() fails when the configured library no longer exists', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse(JSON.stringify({ ServerName: 'My Emby', Version: '4.9.0.1' })),
        )
        .mockResolvedValueOnce(jsonResponse(VIEWS)),
    )

    const client = createEmbyClient('http://emby:8096', 'key', 'user-1', {
      libraryId: 'lib-gone',
    })
    const result = await client.testConnection()
    expect(result.success).toBe(false)
    expect(result.message).toContain('lib-gone')
    expect(result.message).toContain('Music (lib-music)')
    expect(result.message).toContain('Lossless (lib-music-2)')
  })
})
