// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmbyClient } from '@/core/clients/emby'

describe('createEmbyClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
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
              { Id: 'a1', Name: 'Boards of Canada', UserData: { PlayCount: 12, IsFavorite: true } },
            ],
            TotalRecordCount: 1,
          }),
      }),
    )

    const client = createEmbyClient('http://emby:8096', 'key', 'user-1')
    await expect(client.getTopArtists(10)).resolves.toEqual([
      { id: 'a1', name: 'Boards of Canada', playCount: 12, isFavorite: true },
    ])
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
            Items: [{ Id: 'a1', Name: 'Aphex Twin', UserData: { PlayCount: 3 } }],
          }),
        ),
      ),
    )

    const client = createEmbyClient('http://emby:8096', 'key', 'user-1', {
      libraryId: 'lib-music-2',
    })
    await expect(client.getTopArtists(10)).resolves.toEqual([
      { id: 'a1', name: 'Aphex Twin', playCount: 3, isFavorite: false },
    ])
    const url = vi.mocked(fetch).mock.calls[0]?.[0] as string
    expect(url).toContain('/Artists?')
    expect(url).toContain('ParentId=lib-music-2')
    expect(url).toContain('UserId=user-1')
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
