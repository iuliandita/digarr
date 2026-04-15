// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const { createNavidromePlaylistTarget } = await import('@/core/targets/navidrome-playlist')

const CONFIG = { url: 'http://navidrome:4533', username: 'admin', password: 'secret' }

function okResponse(payload: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({
      'subsonic-response': { status: 'ok', version: '1.16.1', ...payload },
    }),
  )
}

function errorResponse(code: number, message: string): Response {
  return new Response(
    JSON.stringify({
      'subsonic-response': {
        status: 'failed',
        version: '1.16.1',
        error: { code, message },
      },
    }),
  )
}

function networkError(): Promise<Response> {
  return Promise.reject(new Error('connect ECONNREFUSED'))
}

afterEach(() => {
  mockFetch.mockReset()
})

describe('createNavidromePlaylistTarget()', () => {
  it('has correct id, type, and capabilities', () => {
    const target = createNavidromePlaylistTarget(5, CONFIG)
    expect(target.id).toBe('navidrome-playlist-5')
    expect(target.type).toBe('navidrome-playlist')
    expect(target.capabilities).toContain('createPlaylist')
    expect(target.capabilities).not.toContain('addArtist')
  })

  describe('testConnection()', () => {
    it('returns success when Navidrome ping succeeds', async () => {
      mockFetch.mockResolvedValueOnce(okResponse({}))

      const target = createNavidromePlaylistTarget(5, CONFIG)
      const result = await target.testConnection()

      expect(result.success).toBe(true)
      expect(result.message).toContain('admin')
    })

    it('includes auth params in the ping request', async () => {
      mockFetch.mockResolvedValueOnce(okResponse({}))

      const target = createNavidromePlaylistTarget(5, CONFIG)
      await target.testConnection()

      const calledUrl = String(mockFetch.mock.calls[0]?.[0])
      expect(calledUrl).toContain('u=admin')
      expect(calledUrl).not.toContain('p=secret')
      expect(calledUrl).toMatch(/[?&]t=[0-9a-f]{32}/)
      expect(calledUrl).toMatch(/[?&]s=[0-9a-f]{16}/)
      expect(calledUrl).toContain('f=json')
      expect(calledUrl).toContain('c=digarr')
    })

    it('returns failure when server is unreachable', async () => {
      mockFetch.mockImplementationOnce(() => networkError())

      const target = createNavidromePlaylistTarget(5, CONFIG)
      const result = await target.testConnection()

      expect(result.success).toBe(false)
      expect(result.message).toContain('ECONNREFUSED')
    })

    it('returns failure when Navidrome returns an error response', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(40, 'Wrong username or password'))

      const target = createNavidromePlaylistTarget(5, CONFIG)
      const result = await target.testConnection()

      expect(result.success).toBe(false)
      expect(result.message).toContain('Wrong username or password')
    })
  })

  describe('createPlaylist()', () => {
    beforeEach(() => {
      mockFetch.mockImplementation(async (url: string | URL | Request) => {
        const urlStr = String(url)

        // search3 - track search
        if (urlStr.includes('/rest/search3')) {
          return okResponse({
            searchResult3: {
              song: [
                { id: 'song-1', title: 'Creep', artist: 'Radiohead' },
                { id: 'song-2', title: 'Karma Police', artist: 'Radiohead' },
              ],
            },
          })
        }

        // createPlaylist
        if (urlStr.includes('/rest/createPlaylist')) {
          return okResponse({ playlist: { id: 'pl-42', name: 'Test Playlist' } })
        }

        // updatePlaylist (add songs or set description)
        if (urlStr.includes('/rest/updatePlaylist')) {
          return okResponse({})
        }

        return new Response('Not Found', { status: 404 })
      })
    })

    it('creates a playlist and returns success', async () => {
      const target = createNavidromePlaylistTarget(5, CONFIG)
      const result = await target.createPlaylist?.('My Playlist', [
        { artistName: 'Radiohead', artistMbid: 'mbid-rh', trackName: 'Creep' },
        { artistName: 'Radiohead', artistMbid: 'mbid-rh', trackName: 'Karma Police' },
      ])

      expect(result?.success).toBe(true)
      expect(result?.playlistId).toBe('pl-42')
      expect(result?.playlistName).toBe('My Playlist')
      expect(result?.itemsAdded).toBe(2)
      expect(result?.targetType).toBe('navidrome-playlist')
      expect(result?.targetId).toBe(5)
    })

    it('skips items without trackName', async () => {
      const target = createNavidromePlaylistTarget(5, CONFIG)
      const result = await target.createPlaylist?.('Artist-only Playlist', [
        // No trackName - artist-level item, should be skipped
        { artistName: 'Radiohead', artistMbid: 'mbid-rh' },
      ])

      expect(result?.success).toBe(true)
      expect(result?.itemsAdded).toBe(0)

      // createPlaylist should still be called, but updatePlaylist should not
      const calls = mockFetch.mock.calls.map((c) => String(c[0]))
      expect(calls.some((u) => u.includes('/rest/createPlaylist'))).toBe(true)
      expect(calls.some((u) => u.includes('/rest/updatePlaylist'))).toBe(false)
    })

    it('handles tracks not found in library gracefully', async () => {
      mockFetch.mockImplementation(async (url: string | URL | Request) => {
        const urlStr = String(url)
        if (urlStr.includes('/rest/search3')) {
          return okResponse({ searchResult3: { song: [] } })
        }
        if (urlStr.includes('/rest/createPlaylist')) {
          return okResponse({ playlist: { id: 'pl-99', name: 'Empty' } })
        }
        if (urlStr.includes('/rest/updatePlaylist')) {
          return okResponse({})
        }
        return new Response('Not Found', { status: 404 })
      })

      const target = createNavidromePlaylistTarget(5, CONFIG)
      const result = await target.createPlaylist?.('Empty Playlist', [
        { artistName: 'Unknown Band', artistMbid: 'mbid-unk', trackName: 'Missing Track' },
      ])

      expect(result?.success).toBe(true)
      expect(result?.itemsAdded).toBe(0)
    })

    it('returns failure when createPlaylist endpoint errors', async () => {
      mockFetch.mockImplementation(async (url: string | URL | Request) => {
        const urlStr = String(url)
        if (urlStr.includes('/rest/search3')) {
          return okResponse({ searchResult3: { song: [] } })
        }
        if (urlStr.includes('/rest/createPlaylist')) {
          return errorResponse(70, 'Requested data was not found')
        }
        return new Response('Not Found', { status: 404 })
      })

      const target = createNavidromePlaylistTarget(5, CONFIG)
      const result = await target.createPlaylist?.('Bad Playlist', [
        { artistName: 'Radiohead', artistMbid: 'mbid-rh', trackName: 'Creep' },
      ])

      expect(result?.success).toBe(false)
      expect(result?.error).toContain('Requested data was not found')
    })

    it('prefers exact title+artist match over first search result', async () => {
      mockFetch.mockImplementation(async (url: string | URL | Request) => {
        const urlStr = String(url)
        if (urlStr.includes('/rest/search3')) {
          return okResponse({
            searchResult3: {
              song: [
                // Partial match first
                { id: 'song-partial', title: 'Creep (Live)', artist: 'Radiohead' },
                // Exact match second
                { id: 'song-exact', title: 'Creep', artist: 'Radiohead' },
              ],
            },
          })
        }
        if (urlStr.includes('/rest/createPlaylist')) {
          return okResponse({ playlist: { id: 'pl-1', name: 'Test' } })
        }
        if (urlStr.includes('/rest/updatePlaylist')) {
          return okResponse({})
        }
        return new Response('Not Found', { status: 404 })
      })

      const target = createNavidromePlaylistTarget(5, CONFIG)
      await target.createPlaylist?.('Test', [
        { artistName: 'Radiohead', artistMbid: 'mbid-rh', trackName: 'Creep' },
      ])

      // The updatePlaylist call should include the exact-match song ID
      const updateCall = mockFetch.mock.calls.find((c) =>
        String(c[0]).includes('/rest/updatePlaylist'),
      )
      expect(String(updateCall?.[0])).toContain('song-exact')
    })

    it('passes description to updatePlaylist', async () => {
      const target = createNavidromePlaylistTarget(5, CONFIG)
      await target.createPlaylist?.('Described Playlist', [], {
        description: 'Auto-generated by Digarr',
      })

      const calls = mockFetch.mock.calls.map((c) => String(c[0]))
      const commentCall = calls.find((u) => u.includes('comment='))
      expect(commentCall).toBeDefined()
      expect(commentCall).toContain('Auto-generated')
    })
  })
})
