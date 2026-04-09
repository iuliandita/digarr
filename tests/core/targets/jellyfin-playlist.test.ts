// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const { createJellyfinPlaylistTarget } = await import('@/core/targets/jellyfin-playlist')

const CONFIG = { url: 'http://jellyfin:8096', apiKey: 'jf-api-key', userId: 'user-uuid-1' }

function ok<T>(body: T): Response {
  return new Response(JSON.stringify(body))
}

function httpError(status: number): Response {
  return new Response('Error', { status })
}

afterEach(() => {
  mockFetch.mockReset()
})

describe('createJellyfinPlaylistTarget()', () => {
  it('has correct id, type, and capabilities', () => {
    const target = createJellyfinPlaylistTarget(7, CONFIG)
    expect(target.id).toBe('jellyfin-playlist-7')
    expect(target.type).toBe('jellyfin-playlist')
    expect(target.capabilities).toContain('createPlaylist')
    expect(target.capabilities).not.toContain('addArtist')
  })

  describe('testConnection()', () => {
    it('returns success with server info', async () => {
      mockFetch.mockResolvedValueOnce(ok({ ServerName: 'Home Media', Version: '10.9.0' }))

      const target = createJellyfinPlaylistTarget(7, CONFIG)
      const result = await target.testConnection()

      expect(result.success).toBe(true)
      expect(result.message).toContain('Home Media')
      expect(result.message).toContain('10.9.0')
    })

    it('sends X-Emby-Token header', async () => {
      mockFetch.mockResolvedValueOnce(ok({ ServerName: 'Test', Version: '10.9.0' }))

      const target = createJellyfinPlaylistTarget(7, CONFIG)
      await target.testConnection()

      const opts = mockFetch.mock.calls[0]?.[1] as RequestInit
      expect(opts.headers).toEqual(expect.objectContaining({ 'X-Emby-Token': 'jf-api-key' }))
    })

    it('passes Bun TLS skip options when configured', async () => {
      mockFetch.mockResolvedValueOnce(ok({ ServerName: 'Test', Version: '10.9.0' }))

      const target = createJellyfinPlaylistTarget(7, {
        ...CONFIG,
        skipTlsVerify: true,
      })
      await target.testConnection()

      const opts = mockFetch.mock.calls[0]?.[1] as RequestInit
      expect(opts).toMatchObject({ tls: { rejectUnauthorized: false } })
    })

    it('returns failure when server is unreachable', async () => {
      mockFetch.mockRejectedValueOnce(new Error('connect ECONNREFUSED'))

      const target = createJellyfinPlaylistTarget(7, CONFIG)
      const result = await target.testConnection()

      expect(result.success).toBe(false)
      expect(result.message).toContain('ECONNREFUSED')
    })

    it('returns failure on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce(httpError(401))

      const target = createJellyfinPlaylistTarget(7, CONFIG)
      const result = await target.testConnection()

      expect(result.success).toBe(false)
      expect(result.message).toContain('401')
    })
  })

  describe('createPlaylist()', () => {
    beforeEach(() => {
      mockFetch.mockImplementation(async (url: string | URL | Request, opts?: RequestInit) => {
        const urlStr = String(url)

        // GET /Users/{userId}/Items -- track search
        if (urlStr.includes('/Items') && (!opts?.method || opts.method === 'GET')) {
          return ok({
            Items: [
              { Id: 'item-1', Name: 'Creep', AlbumArtist: 'Radiohead', Artists: ['Radiohead'] },
              {
                Id: 'item-2',
                Name: 'Karma Police',
                AlbumArtist: 'Radiohead',
                Artists: ['Radiohead'],
              },
            ],
            TotalRecordCount: 2,
          })
        }

        // POST /Playlists -- create playlist
        if (urlStr.includes('/Playlists') && opts?.method === 'POST') {
          return ok({ Id: 'jf-pl-1', Name: 'Digarr Picks' })
        }

        return new Response('Not Found', { status: 404 })
      })
    })

    it('creates a playlist and returns success', async () => {
      const target = createJellyfinPlaylistTarget(7, CONFIG)
      const result = await target.createPlaylist?.('Digarr Picks', [
        { artistName: 'Radiohead', artistMbid: 'mbid-rh', trackName: 'Creep' },
        { artistName: 'Radiohead', artistMbid: 'mbid-rh', trackName: 'Karma Police' },
      ])

      expect(result?.success).toBe(true)
      expect(result?.playlistId).toBe('jf-pl-1')
      expect(result?.playlistName).toBe('Digarr Picks')
      expect(result?.itemsAdded).toBe(2)
      expect(result?.targetType).toBe('jellyfin-playlist')
      expect(result?.targetId).toBe(7)
    })

    it('skips items without trackName', async () => {
      const target = createJellyfinPlaylistTarget(7, CONFIG)
      const result = await target.createPlaylist?.('Artist Only', [
        { artistName: 'Radiohead', artistMbid: 'mbid-rh' },
      ])

      expect(result?.success).toBe(true)
      expect(result?.itemsAdded).toBe(0)

      // No search calls made
      const calls = mockFetch.mock.calls.map((c) => String(c[0]))
      const searchCalls = calls.filter((u) => u.includes('/Items') && !u.includes('/Playlists'))
      expect(searchCalls).toHaveLength(0)
    })

    it('handles tracks not found in Jellyfin gracefully', async () => {
      mockFetch.mockImplementation(async (url: string | URL | Request, opts?: RequestInit) => {
        const urlStr = String(url)
        if (urlStr.includes('/Items') && (!opts?.method || opts.method === 'GET')) {
          return ok({ Items: [], TotalRecordCount: 0 })
        }
        if (urlStr.includes('/Playlists') && opts?.method === 'POST') {
          return ok({ Id: 'jf-pl-empty', Name: 'Empty' })
        }
        return new Response('Not Found', { status: 404 })
      })

      const target = createJellyfinPlaylistTarget(7, CONFIG)
      const result = await target.createPlaylist?.('Empty Playlist', [
        { artistName: 'Ghost Band', artistMbid: 'mbid-x', trackName: 'Missing' },
      ])

      expect(result?.success).toBe(true)
      expect(result?.itemsAdded).toBe(0)
    })

    it('returns failure when POST /Playlists errors', async () => {
      mockFetch.mockImplementation(async (url: string | URL | Request, opts?: RequestInit) => {
        const urlStr = String(url)
        if (urlStr.includes('/Items') && (!opts?.method || opts.method === 'GET')) {
          return ok({ Items: [], TotalRecordCount: 0 })
        }
        if (urlStr.includes('/Playlists') && opts?.method === 'POST') {
          return httpError(500)
        }
        return new Response('Not Found', { status: 404 })
      })

      const target = createJellyfinPlaylistTarget(7, CONFIG)
      const result = await target.createPlaylist?.('Bad', [
        { artistName: 'X', artistMbid: 'mbid-x', trackName: 'Y' },
      ])

      expect(result?.success).toBe(false)
      expect(result?.error).toContain('500')
    })

    it('prefers exact artist+title match in search results', async () => {
      mockFetch.mockImplementation(async (url: string | URL | Request, opts?: RequestInit) => {
        const urlStr = String(url)
        if (urlStr.includes('/Items') && (!opts?.method || opts.method === 'GET')) {
          return ok({
            Items: [
              // Partial match first
              {
                Id: 'item-partial',
                Name: 'Creep (Acoustic)',
                AlbumArtist: 'Radiohead',
                Artists: ['Radiohead'],
              },
              // Exact match second
              { Id: 'item-exact', Name: 'Creep', AlbumArtist: 'Radiohead', Artists: ['Radiohead'] },
            ],
            TotalRecordCount: 2,
          })
        }
        if (urlStr.includes('/Playlists') && opts?.method === 'POST') {
          const body = JSON.parse(opts.body as string) as { Ids: string[] }
          // Check which ID was passed
          return ok({ Id: 'jf-pl-x', Name: 'T', _passedIds: body.Ids })
        }
        return new Response('Not Found', { status: 404 })
      })

      const target = createJellyfinPlaylistTarget(7, CONFIG)
      const result = await target.createPlaylist?.('Test', [
        { artistName: 'Radiohead', artistMbid: 'mbid-rh', trackName: 'Creep' },
      ])

      // Find the POST /Playlists call and check passed IDs
      const postCall = mockFetch.mock.calls.find((c) => {
        const [u, o] = c as [string, RequestInit | undefined]
        return String(u).includes('/Playlists') && o?.method === 'POST'
      })
      const body = JSON.parse(postCall?.[1]?.body as string) as { Ids: string[] }
      expect(body.Ids).toContain('item-exact')
      expect(body.Ids).not.toContain('item-partial')
      expect(result?.success).toBe(true)
    })
  })
})
