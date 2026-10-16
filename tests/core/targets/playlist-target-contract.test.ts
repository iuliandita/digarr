// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DestinationTarget } from '@/core/targets/types'

// Jellyfin and Navidrome playlist targets share one behavioral contract for
// createPlaylist(); transport details live in the adapters below. Protocol-specific
// cases (auth, entry replacement, pagination, redaction) stay in each target's own suite.

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const { createJellyfinPlaylistTarget } = await import('@/core/targets/jellyfin-playlist')
const { createNavidromePlaylistTarget } = await import('@/core/targets/navidrome-playlist')

type Song = { id: string; title: string; artist: string }

type Flavor = {
  name: string
  targetType: string
  targetId: number
  forbiddenError: string
  make: () => DestinationTarget
  serve: (songs: Song[], remotePlaylistId: string) => void
  /** Number of requests that wrote a playlist (create or add). */
  writeRequests: () => number
  createRequests: () => number
  searchRequests: () => number
  addedSongIds: () => string[]
}

function jellyfinPost(url: unknown, init: unknown): boolean {
  return String(url).includes('/Playlists') && (init as RequestInit | undefined)?.method === 'POST'
}

const jellyfin: Flavor = {
  name: 'jellyfin',
  targetType: 'jellyfin-playlist',
  targetId: 7,
  forbiddenError: 'Jellyfin API 403: forbidden',
  make: () =>
    createJellyfinPlaylistTarget(7, {
      url: 'http://jellyfin:8096',
      apiKey: 'jf-api-key',
      userId: 'user-uuid-1',
    }),
  serve: (songs, remotePlaylistId) => {
    mockFetch.mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = String(url)
      if (urlStr.includes('/Items') && (!init?.method || init.method === 'GET')) {
        return new Response(
          JSON.stringify({
            Items: songs.map((s) => ({
              Id: s.id,
              Name: s.title,
              AlbumArtist: s.artist,
              Artists: [s.artist],
            })),
            TotalRecordCount: songs.length,
          }),
        )
      }
      if (urlStr.includes('/Playlists') && init?.method === 'POST') {
        return new Response(JSON.stringify({ Id: remotePlaylistId, Name: 'Remote' }))
      }
      return new Response('Not Found', { status: 404 })
    })
  },
  writeRequests: () => mockFetch.mock.calls.filter(([u, i]) => jellyfinPost(u, i)).length,
  createRequests: () => mockFetch.mock.calls.filter(([u, i]) => jellyfinPost(u, i)).length,
  searchRequests: () =>
    mockFetch.mock.calls.filter(
      ([u]) => String(u).includes('/Items') && !String(u).includes('/Playlists'),
    ).length,
  addedSongIds: () => {
    const call = mockFetch.mock.calls.find(([u, i]) => jellyfinPost(u, i))
    const body = (call?.[1] as RequestInit | undefined)?.body
    return (JSON.parse(String(body)) as { Ids: string[] }).Ids
  },
}

function subsonicOk(payload: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({ 'subsonic-response': { status: 'ok', version: '1.16.1', ...payload } }),
  )
}

const navidrome: Flavor = {
  name: 'navidrome',
  targetType: 'navidrome-playlist',
  targetId: 5,
  forbiddenError: 'Subsonic HTTP 403: forbidden',
  make: () =>
    createNavidromePlaylistTarget(5, {
      url: 'http://navidrome:4533',
      username: 'admin',
      password: 'secret',
    }),
  serve: (songs, remotePlaylistId) => {
    mockFetch.mockImplementation(async (url: string | URL | Request) => {
      const urlStr = String(url)
      if (urlStr.includes('/rest/search3')) {
        return subsonicOk({
          searchResult3: {
            song: songs.map((s) => ({ id: s.id, title: s.title, artist: s.artist })),
          },
        })
      }
      if (urlStr.includes('/rest/createPlaylist')) {
        return subsonicOk({ playlist: { id: remotePlaylistId, name: 'Remote' } })
      }
      if (urlStr.includes('/rest/updatePlaylist')) return subsonicOk({})
      return new Response('Not Found', { status: 404 })
    })
  },
  writeRequests: () =>
    mockFetch.mock.calls.filter(([u]) => /\/rest\/(createPlaylist|updatePlaylist)/.test(String(u)))
      .length,
  createRequests: () =>
    mockFetch.mock.calls.filter(([u]) => String(u).includes('/rest/createPlaylist')).length,
  searchRequests: () =>
    mockFetch.mock.calls.filter(([u]) => String(u).includes('/rest/search3')).length,
  addedSongIds: () => {
    const call = mockFetch.mock.calls.find(([u]) => String(u).includes('songIdToAdd'))
    return new URL(String(call?.[0])).searchParams.getAll('songIdToAdd')
  },
}

const CREEP = { artistName: 'Radiohead', artistMbid: 'mbid-rh', trackName: 'Creep' }
const KARMA = { artistName: 'Radiohead', artistMbid: 'mbid-rh', trackName: 'Karma Police' }

afterEach(() => {
  mockFetch.mockReset()
})

describe.each([jellyfin, navidrome])(
  '$name playlist target createPlaylist() contract',
  (flavor) => {
    it('has correct id, type, and capabilities', () => {
      const target = flavor.make()
      expect(target.id).toBe(`${flavor.targetType}-${flavor.targetId}`)
      expect(target.type).toBe(flavor.targetType)
      expect(target.capabilities).toContain('createPlaylist')
      expect(target.capabilities).not.toContain('addArtist')
    })

    it('creates a playlist and returns success', async () => {
      flavor.serve(
        [
          { id: 'song-1', title: 'Creep', artist: 'Radiohead' },
          { id: 'song-2', title: 'Karma Police', artist: 'Radiohead' },
        ],
        'remote-pl-1',
      )

      const result = await flavor.make().createPlaylist?.('My Playlist', [CREEP, KARMA])

      expect(result?.success).toBe(true)
      expect(result?.playlistId).toBe('remote-pl-1')
      expect(result?.playlistName).toBe('My Playlist')
      expect(result?.itemsAdded).toBe(2)
      expect(result?.targetType).toBe(flavor.targetType)
      expect(result?.targetId).toBe(flavor.targetId)
    })

    it('skips items without trackName', async () => {
      flavor.serve([], 'remote-pl-2')

      const result = await flavor
        .make()
        .createPlaylist?.('Artist Only', [{ artistName: 'Radiohead', artistMbid: 'mbid-rh' }])

      expect(result?.success).toBe(true)
      expect(result?.itemsAdded).toBe(0)
      expect(flavor.searchRequests()).toBe(0)
      expect(flavor.createRequests()).toBe(1)
      expect(flavor.writeRequests()).toBe(1)
    })

    it('handles tracks not found in the library gracefully', async () => {
      flavor.serve([], 'remote-pl-3')

      const result = await flavor
        .make()
        .createPlaylist?.('Empty Playlist', [
          { artistName: 'Ghost Band', artistMbid: 'mbid-x', trackName: 'Missing' },
        ])

      expect(result?.success).toBe(true)
      expect(result?.itemsAdded).toBe(0)
    })

    it('fails without creating a playlist when track search is forbidden', async () => {
      mockFetch.mockResolvedValueOnce(new Response('forbidden', { status: 403 }))

      const result = await flavor.make().createPlaylist?.('Forbidden', [CREEP])

      expect(result).toMatchObject({ success: false, error: flavor.forbiddenError })
      expect(flavor.createRequests()).toBe(0)
    })

    it('prefers the exact title+artist match over the first search result', async () => {
      flavor.serve(
        [
          { id: 'song-partial', title: 'Creep (Live)', artist: 'Radiohead' },
          { id: 'song-exact', title: 'Creep', artist: 'Radiohead' },
        ],
        'remote-pl-4',
      )

      const result = await flavor.make().createPlaylist?.('Test', [CREEP])

      expect(result?.success).toBe(true)
      expect(flavor.addedSongIds()).toContain('song-exact')
      expect(flavor.addedSongIds()).not.toContain('song-partial')
    })
  },
)
