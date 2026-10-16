// @vitest-environment node

import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPlaylistScope } from '@/core/targets/playlist-scope'

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
      mockFetch.mockImplementation(() => networkError())

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

    it('redacts Subsonic auth parameters from HTTP errors', async () => {
      mockFetch.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))

      const target = createNavidromePlaylistTarget(5, CONFIG)
      const result = await target.testConnection()

      expect(result.success).toBe(false)
      expect(result.message).not.toMatch(/[?&]t=[0-9a-f]{32}/)
      expect(result.message).not.toMatch(/[?&]s=[0-9a-f]{16}/)
      expect(result.message).toBe('Subsonic HTTP 401: Unauthorized')
    })

    it('returns a clean failure for a response without a Subsonic envelope', async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'gateway' })))

      const target = createNavidromePlaylistTarget(5, CONFIG)
      const result = await target.testConnection()

      expect(result).toEqual({
        success: false,
        message: 'Malformed Subsonic response (missing subsonic-response envelope)',
      })
    })

    it('retries a read-only ping when the server recovers', async () => {
      mockFetch
        .mockResolvedValueOnce(new Response('temporary outage', { status: 500 }))
        .mockResolvedValueOnce(okResponse({}))

      const target = createNavidromePlaylistTarget(5, CONFIG)
      const result = await target.testConnection()

      expect(result.success).toBe(true)
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('returns a provider-shaped error for malformed JSON', async () => {
      mockFetch.mockResolvedValueOnce(new Response('not-json'))

      const target = createNavidromePlaylistTarget(5, CONFIG)
      const result = await target.testConnection()

      expect(result).toEqual({
        success: false,
        message: 'Subsonic HTTP 200: Invalid JSON: not-json',
      })
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

    it('redacts auth values from failed Subsonic search envelopes', async () => {
      let token = ''
      let salt = ''
      mockFetch.mockImplementation(async (url: string | URL | Request) => {
        const parsed = new URL(String(url))
        token = parsed.searchParams.get('t') ?? ''
        salt = parsed.searchParams.get('s') ?? ''
        return errorResponse(40, `authentication failed t=${token}&s=${salt}`)
      })

      const target = createNavidromePlaylistTarget(5, CONFIG)
      const result = await target.createPlaylist?.('Forbidden', [
        { artistName: 'Radiohead', artistMbid: 'mbid-rh', trackName: 'Creep' },
      ])

      expect(result).toMatchObject({ success: false })
      expect(result?.error).toContain('t=[REDACTED]&s=[REDACTED]')
      expect(result?.error).not.toContain(token)
      expect(result?.error).not.toContain(salt)
      expect(
        mockFetch.mock.calls.some(
          ([requestUrl]) =>
            String(requestUrl).includes('/rest/createPlaylist') ||
            String(requestUrl).includes('/rest/updatePlaylist'),
        ),
      ).toBe(false)
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

    it('makes one create request and redacts echoed auth values from the body', async () => {
      let token = ''
      let salt = ''
      mockFetch.mockImplementation(async (url: string | URL | Request) => {
        const parsed = new URL(String(url))
        if (parsed.pathname.includes('/rest/createPlaylist')) {
          token = parsed.searchParams.get('t') ?? ''
          salt = parsed.searchParams.get('s') ?? ''
          return new Response(`failed t=${token}&s=${salt}`, { status: 500 })
        }
        return okResponse({})
      })

      const target = createNavidromePlaylistTarget(5, CONFIG)
      const result = await target.createPlaylist?.('Bad Playlist', [])

      expect(result).toMatchObject({
        success: false,
        error: 'Subsonic HTTP 500: failed t=[REDACTED]&s=[REDACTED]',
      })
      expect(result?.error).not.toContain(token)
      expect(result?.error).not.toContain(salt)
      expect(
        mockFetch.mock.calls.filter(([url]) => String(url).includes('/rest/createPlaylist')),
      ).toHaveLength(1)
    })

    it('makes one song-add request when updatePlaylist returns 500', async () => {
      mockFetch.mockImplementation(async (url: string | URL | Request) => {
        const value = String(url)
        if (value.includes('/rest/search3')) {
          return okResponse({
            searchResult3: { song: [{ id: 'song-1', title: 'Creep', artist: 'Radiohead' }] },
          })
        }
        if (value.includes('/rest/createPlaylist')) {
          return okResponse({ playlist: { id: 'pl-42', name: 'Test' } })
        }
        if (value.includes('songIdToAdd')) {
          return new Response('song update unavailable', { status: 500 })
        }
        return okResponse({})
      })

      const target = createNavidromePlaylistTarget(5, CONFIG)
      const result = await target.createPlaylist?.('Test', [
        { artistName: 'Radiohead', artistMbid: 'mbid-rh', trackName: 'Creep' },
      ])

      expect(result).toMatchObject({
        success: false,
        error: 'Subsonic HTTP 500: song update unavailable',
      })
      expect(
        mockFetch.mock.calls.filter(([url]) => String(url).includes('songIdToAdd')),
      ).toHaveLength(1)
    })

    it('does not retry a best-effort comment mutation', async () => {
      let commentAttempts = 0
      mockFetch.mockImplementation(async (url: string | URL | Request) => {
        const value = String(url)
        if (value.includes('/rest/createPlaylist')) {
          return okResponse({ playlist: { id: 'pl-42', name: 'Test' } })
        }
        if (value.includes('comment=')) {
          commentAttempts += 1
          if (commentAttempts === 1) return new Response('temporary outage', { status: 500 })
        }
        return okResponse({})
      })

      const target = createNavidromePlaylistTarget(5, CONFIG)
      const result = await target.createPlaylist?.('Test', [], { description: 'Description' })

      expect(result?.success).toBe(true)
      expect(commentAttempts).toBe(1)
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

    it('uses a fresh auth salt for each target request', async () => {
      const target = createNavidromePlaylistTarget(5, CONFIG)
      await target.createPlaylist?.('Test', [
        { artistName: 'Radiohead', artistMbid: 'mbid-rh', trackName: 'Creep' },
      ])

      const salts = mockFetch.mock.calls.map(([url]) => new URL(String(url)).searchParams.get('s'))
      expect(salts).toHaveLength(3)
      expect(new Set(salts).size).toBe(3)
    })
  })
})

describe('Navidrome scheduled export session', () => {
  const item = { artistName: 'Radiohead', artistMbid: 'mbid-rh', trackName: 'Creep' }

  beforeEach(() => {
    mockFetch.mockImplementation(async (url) => {
      const parsed = new URL(String(url))
      if (parsed.pathname.endsWith('/getUser'))
        return okResponse({ user: { username: parsed.searchParams.get('username') } })
      if (parsed.pathname.endsWith('/search3'))
        return okResponse({
          searchResult3: { song: [{ id: 'song-1', title: 'Creep', artist: 'Radiohead' }] },
        })
      if (parsed.pathname.endsWith('/getPlaylist'))
        return okResponse({ playlist: { id: 'pl-42', owner: 'admin' } })
      if (parsed.pathname.endsWith('/createPlaylist'))
        return okResponse({ playlist: { id: 'pl-42' } })
      return okResponse({})
    })
  })

  it.each([
    ['empty input', [], 'admin'],
    ['unmatched tracks', [{ ...item, trackName: 'Missing' }], 'admin'],
    ['missing identity', [item], undefined],
    ['wrong identity', [item], 'other'],
  ])('rejects %s before mutations', async (_name, items, username) => {
    mockFetch.mockImplementation(async (url) =>
      String(url).includes('/getUser')
        ? okResponse({ user: { username } })
        : okResponse({ searchResult3: { song: [] } }),
    )
    const target = createNavidromePlaylistTarget(5, CONFIG)
    await expect(target.openPlaylistExportSession?.(items)).rejects.toThrow()
    expect(
      mockFetch.mock.calls.some(([url]) => /\/(createPlaylist|updatePlaylist)\?/.test(String(url))),
    ).toBe(false)
  })

  it.each([false, true])(
    'checkpoints creation before repeated song parameters (checkpoint fails: %s)',
    async (fails) => {
      const config = { ...CONFIG }
      const target = createNavidromePlaylistTarget(5, config)
      const session = await target.openPlaylistExportSession?.([item, item])
      expect(session?.scope).toBe(createPlaylistScope('navidrome-playlist', [CONFIG.url, 'admin']))
      config.password = 'rotated-password'
      const checkpoint = vi.fn(async (id: string) => {
        expect(id).toBe('pl-42')
        expect(mockFetch.mock.calls.some(([url]) => String(url).includes('/updatePlaylist'))).toBe(
          false,
        )
        if (fails) throw new Error(`checkpoint failed ${CONFIG.password}`)
      })
      const result = await session?.createPlaylist('Generated', checkpoint)
      expect(result).toMatchObject({ success: !fails, playlistId: 'pl-42' })
      expect(checkpoint).toHaveBeenCalledOnce()
      const updates = mockFetch.mock.calls.filter(([url]) =>
        String(url).includes('/updatePlaylist'),
      )
      expect(updates).toHaveLength(fails ? 0 : 1)
      if (!fails) {
        const params = new URL(String(updates[0]?.[0])).searchParams
        expect(params.getAll('songIdToAdd')).toEqual(['song-1', 'song-1'])
        expect([...params.keys()].some((key) => key.includes('['))).toBe(false)
      } else expect(result?.error).not.toContain(CONFIG.password)
      for (const [url] of mockFetch.mock.calls) {
        const params = new URL(String(url)).searchParams
        expect(params.get('t')).toBe(
          createHash('md5')
            .update(CONFIG.password + params.get('s'))
            .digest('hex'),
        )
      }
    },
  )

  it('scopes the full canonical endpoint and verified user without the password', async () => {
    const scopes = []
    for (const config of [
      { ...CONFIG, url: 'http://NAVIDROME:4533/library/' },
      { ...CONFIG, url: 'http://navidrome:4533/library', password: 'new-password' },
      { ...CONFIG, url: 'http://navidrome:4533/another' },
      { ...CONFIG, url: 'http://navidrome:4533/library', username: 'other' },
    ])
      scopes.push(
        (await createNavidromePlaylistTarget(5, config).openPlaylistExportSession?.([item]))?.scope,
      )
    expect(scopes[0]).toBe(scopes[1])
    expect(scopes[0]).not.toBe(scopes[2])
    expect(scopes[0]).not.toBe(scopes[3])
  })

  it.each(['success', 'missing owner', 'wrong owner', 'not found', 'replace failure'])(
    'replaces only a verified owned playlist: %s',
    async (outcome) => {
      let replaceAttempts = 0
      mockFetch.mockImplementation(async (url) => {
        const parsed = new URL(String(url))
        if (parsed.pathname.endsWith('/getUser')) return okResponse({ user: { username: 'admin' } })
        if (parsed.pathname.endsWith('/search3'))
          return okResponse({
            searchResult3: { song: [{ id: 'song-1', title: 'Creep', artist: 'Radiohead' }] },
          })
        if (parsed.pathname.endsWith('/getPlaylist')) {
          if (outcome === 'not found') return new Response('gone', { status: 404 })
          return okResponse({
            playlist: {
              id: 'pl-42',
              ...(outcome === 'missing owner'
                ? {}
                : { owner: outcome === 'wrong owner' ? 'other' : 'admin' }),
            },
          })
        }
        if (parsed.pathname.endsWith('/createPlaylist')) {
          replaceAttempts += 1
          expect(parsed.searchParams.get('playlistId')).toBe('pl-42')
          expect(parsed.searchParams.get('name')).toBeNull()
          expect(parsed.searchParams.getAll('songId')).toEqual(['song-1', 'song-1'])
          if (outcome === 'replace failure') return new Response('replace failed', { status: 500 })
          return okResponse({ playlist: { id: 'pl-42' } })
        }
        return okResponse({})
      })
      const session = await createNavidromePlaylistTarget(5, CONFIG).openPlaylistExportSession?.([
        item,
        item,
        { ...item, trackName: 'Missing' },
      ])
      expect(await session?.replacePlaylist('pl-42', 'Renamed')).toMatchObject({
        success: outcome === 'success',
        playlistId: 'pl-42',
      })
      expect(replaceAttempts).toBe(['success', 'replace failure'].includes(outcome) ? 1 : 0)
      const updates = mockFetch.mock.calls.filter(([url]) =>
        String(url).includes('/updatePlaylist'),
      )
      expect(updates).toHaveLength(outcome === 'success' ? 1 : 0)
      if (outcome === 'success') {
        expect(new URL(String(updates[0]?.[0])).searchParams.get('name')).toBe('Renamed')
        expect(await session?.replacePlaylist('pl-42', 'Renamed')).toMatchObject({
          success: true,
          itemsAdded: 2,
          itemsSkipped: 1,
        })
      }
    },
  )

  it.each(['envelope', 'transport'])(
    'redacts credentials from %s preparation failures',
    async (kind) => {
      let token = ''
      let salt = ''
      mockFetch.mockImplementation(async (url) => {
        const params = new URL(String(url)).searchParams
        token = params.get('t') ?? ''
        salt = params.get('s') ?? ''
        const message = `failed ${CONFIG.password} t=${token}&s=${salt}`
        if (kind === 'transport') throw new Error(message)
        return errorResponse(40, message)
      })
      let message = ''
      try {
        await createNavidromePlaylistTarget(5, CONFIG).openPlaylistExportSession?.([item])
      } catch (error) {
        message = (error as Error).message
      }
      expect(message).toContain('[REDACTED]')
      expect(message).not.toContain(CONFIG.password)
      expect(message).not.toContain(token)
      expect(message).not.toContain(salt)
      expect(
        mockFetch.mock.calls.some(([url]) =>
          /\/(createPlaylist|updatePlaylist)\?/.test(String(url)),
        ),
      ).toBe(false)
    },
  )
})
