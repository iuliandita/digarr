// @vitest-environment node
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSpotifyPlaylistAdapter } from '@/core/subscriptions/adapters/spotify-playlist'

const PLAYLIST_ID = 'testPlaylist123'
const TOKEN = 'secret-owner-token'
let server: http.Server
let baseUrl: string
let requests: URL[]
let respond: (url: URL, res: http.ServerResponse) => void
const artist = (name: string) => ({ item: { type: 'track', artists: [{ name, id: name }] } })
const json = (res: http.ServerResponse, body: unknown, status = 200) => {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}
const next = (offset: number) =>
  `${baseUrl}/playlists/${PLAYLIST_ID}/items?offset=${offset}&limit=50`
const adapter = (getToken = vi.fn(async () => TOKEN)) =>
  createSpotifyPlaylistAdapter({ getToken, baseUrl })

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '', baseUrl)
    requests.push(url)
    expect(req.headers.authorization).toBe(`Bearer ${TOKEN}`)
    respond(url, res)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => server.close())
beforeEach(() => {
  requests = []
  respond = (_url, res) => json(res, { items: [], next: null })
})

describe('Spotify playlist pagination', () => {
  it('reads current and legacy items in encounter order, deduplicates, and honors the artist cap', async () => {
    respond = (url, res) => {
      if (url.searchParams.get('offset') === '0') {
        json(res, {
          items: [artist('Alpha'), { track: { artists: [{ name: 'Beta' }, { name: 'Gamma' }] } }],
          next: next(2),
        })
      } else {
        json(res, { items: [artist('ALPHA'), artist('Delta'), artist('Epsilon')], next: next(5) })
      }
    }
    const getToken = vi.fn(async () => TOKEN)
    const result = await adapter(getToken).fetch({ playlistId: PLAYLIST_ID }, { limit: 4 })
    expect(result.artists.map((entry) => entry.name)).toEqual(['Alpha', 'Beta', 'Gamma', 'Delta'])
    expect(result.artists[0]).toMatchObject({
      similarityScore: 0.7,
      source: `spotify-playlist:${PLAYLIST_ID}`,
      sourceUrl: `https://open.spotify.com/playlist/${PLAYLIST_ID}`,
    })
    expect(requests).toHaveLength(2)
    expect(
      requests.every(
        (url) =>
          url.pathname === `/playlists/${PLAYLIST_ID}/items` &&
          url.searchParams.get('limit') === '50',
      ),
    ).toBe(true)
    expect(getToken).toHaveBeenCalledOnce()
  })

  it.each([
    PLAYLIST_ID,
    `spotify:playlist:${PLAYLIST_ID}`,
    `https://open.spotify.com/playlist/${PLAYLIST_ID}?si=abc`,
  ])('accepts playlist identifier %s', async (playlistId) => {
    await adapter().fetch({ playlistId })
    expect(requests[0]?.pathname).toBe(`/playlists/${PLAYLIST_ID}/items`)
  })

  it('continues across null, episode-only, and empty pages until the terminal page', async () => {
    respond = (url, res) => {
      const offset = Number(url.searchParams.get('offset'))
      const pages: Record<number, unknown> = {
        0: {
          items: [{ item: null, track: { artists: [{ name: 'Must not leak' }] } }],
          next: next(1),
        },
        1: { items: [{ item: { type: 'episode' } }], next: next(2) },
        2: { items: [], next: next(52) },
        52: { items: [artist('Final')], next: null },
      }
      json(res, pages[offset])
    }
    const result = await adapter().fetch({ playlistId: PLAYLIST_ID })
    expect(result.artists.map((entry) => entry.name)).toEqual(['Final'])
    expect(requests).toHaveLength(4)
  })

  it('continues a sparse requested window at the next page-size offset', async () => {
    respond = (url, res) => {
      if (url.searchParams.get('offset') === '0')
        json(res, { items: [artist('First')], next: next(50) })
      else json(res, { items: [artist('Later')], next: null })
    }
    const result = await adapter().fetch({ playlistId: PLAYLIST_ID })
    expect(result.artists.map((entry) => entry.name)).toEqual(['First', 'Later'])
    expect(requests.map((url) => url.searchParams.get('offset'))).toEqual(['0', '50'])
  })

  it.each(['entry', 'track'])(
    'keeps named local artists and continues past incomplete local metadata marked on the %s',
    async (marker) => {
      const local = (artists: unknown) => ({
        ...(marker === 'entry' ? { is_local: true } : {}),
        item: { type: 'track', artists, ...(marker === 'track' ? { is_local: true } : {}) },
      })
      respond = (url, res) => {
        if (url.searchParams.get('offset') === '0')
          json(res, {
            items: [
              local([
                { id: null },
                { name: null },
                { name: '' },
                { name: ' ' },
                { name: 'Named Local', id: null },
                { name: 'Collaborator' },
              ]),
              local(undefined),
              local(null),
            ],
            next: next(50),
          })
        else json(res, { items: [artist('Later')], next: null })
      }
      const result = await adapter().fetch({ playlistId: PLAYLIST_ID })
      expect(result.artists.map((entry) => entry.name)).toEqual([
        'Named Local',
        'Collaborator',
        'Later',
      ])
      expect(requests).toHaveLength(2)
    },
  )

  it('returns genuinely empty playlists and skips blank IDs or a zero cap without authentication', async () => {
    expect((await adapter().fetch({ playlistId: PLAYLIST_ID })).artists).toEqual([])
    const getToken = vi.fn(async () => TOKEN)
    expect((await adapter(getToken).fetch({})).artists).toEqual([])
    expect(
      (await adapter(getToken).fetch({ playlistId: PLAYLIST_ID }, { limit: 0 })).artists,
    ).toEqual([])
    expect(getToken).not.toHaveBeenCalled()
  })

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid artist cap %s',
    async (limit) => {
      await expect(adapter().fetch({ playlistId: PLAYLIST_ID }, { limit })).rejects.toThrow('limit')
      expect(requests).toHaveLength(0)
    },
  )

  it.each(['bad/id', 'spotify:playlist:bad-id', 'https://open.spotify.com/playlist/bad-id'])(
    'rejects malformed identifier %s',
    async (playlistId) => {
      await expect(adapter().fetch({ playlistId })).rejects.toThrow('playlist ID')
      expect(requests).toHaveLength(0)
    },
  )

  it.each([401, 403, 429, 500])(
    'fails the whole fetch after a later HTTP %s without exposing tokens',
    async (status) => {
      respond = (url, res) => {
        if (url.searchParams.get('offset') === '0')
          json(res, { items: [artist('First')], next: next(1) })
        else {
          res.statusMessage = TOKEN
          json(res, { error: TOKEN }, status)
        }
      }
      const error = await adapter()
        .fetch({ playlistId: PLAYLIST_ID })
        .catch((value: unknown) => value)
      expect(error).toBeInstanceOf(Error)
      expect(String(error)).toContain(String(status))
      expect(String(error)).not.toContain(TOKEN)
      expect(error).not.toHaveProperty('cause')
    },
  )

  it.each([
    null,
    {},
    { items: [], next: 4 },
    { items: [] },
    { items: 'bad', next: null },
    { items: [null], next: null },
    { items: [{ item: {} }], next: null },
    { items: [{ item: { artists: [{ name: 2 }] } }], next: null },
    { items: [{ item: { artists: [{ name: null }] } }], next: null },
    { items: [{ item: { is_local: true, artists: 'bad' } }], next: null },
    { items: [{ item: { is_local: true, artists: [{ name: 2 }] } }], next: null },
  ])('rejects malformed page %j', async (body) => {
    respond = (_url, res) => json(res, body)
    await expect(adapter().fetch({ playlistId: PLAYLIST_ID })).rejects.toThrow('malformed')
  })

  it.each([
    () => 'https://evil.example/items?offset=1',
    () => `${baseUrl}/playlists/other/items?offset=1`,
    () => `${baseUrl}/playlists/${PLAYLIST_ID}/items?offset=0`,
    () => `${baseUrl}/playlists/${PLAYLIST_ID}/items?offset=2`,
    () => `${baseUrl}/playlists/${PLAYLIST_ID}/items?offset=1&offset=1`,
    () => `${baseUrl}/playlists/${PLAYLIST_ID}/items?offset=1.0`,
    () => `${baseUrl}/playlists/${PLAYLIST_ID}/items?offset=1#fragment`,
    () => `${baseUrl.replace('://', '://user:password@')}/playlists/${PLAYLIST_ID}/items?offset=1`,
  ])('rejects hostile or nonprogressing pagination links', async (link) => {
    respond = (_url, res) => json(res, { items: [artist('First')], next: link() })
    await expect(adapter().fetch({ playlistId: PLAYLIST_ID })).rejects.toThrow('pagination')
    expect(requests).toHaveLength(1)
  })

  it('reconstructs the next request instead of forwarding arbitrary query parameters', async () => {
    respond = (url, res) => {
      if (url.searchParams.get('offset') === '0')
        json(res, { items: [artist('First')], next: `${next(1)}&secret=${TOKEN}&limit=500` })
      else json(res, { items: [artist('Second')], next: null })
    }
    expect((await adapter().fetch({ playlistId: PLAYLIST_ID })).artists).toHaveLength(2)
    expect([...(requests[1]?.searchParams.keys() ?? [])]).toEqual(['limit', 'offset'])
    expect(requests[1]?.searchParams.get('limit')).toBe('50')
  })

  it('refuses redirects without requesting their destination', async () => {
    respond = (_url, res) => {
      res.writeHead(302, { Location: `${baseUrl}/redirected?token=${TOKEN}` })
      res.end()
    }
    await expect(adapter().fetch({ playlistId: PLAYLIST_ID })).rejects.toThrow('Spotify playlist')
    expect(requests).toHaveLength(1)
  })

  it('rejects malformed JSON without including the response body', async () => {
    respond = (_url, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(TOKEN)
    }
    const error = await adapter()
      .fetch({ playlistId: PLAYLIST_ID })
      .catch((value: unknown) => value)
    expect(String(error)).toContain('malformed')
    expect(String(error)).not.toContain(TOKEN)
  })

  it('keeps the request timeout active while reading the response body', async () => {
    let started: (() => void) | undefined
    const bodyStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    respond = (_url, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.write('{"items":[')
      started?.()
    }
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const result = adapter().fetch({ playlistId: PLAYLIST_ID })
      const rejected = expect(result).rejects.toThrow('Spotify playlist')
      await bodyStarted
      await vi.advanceTimersByTimeAsync(10_000)
      await rejected
    } finally {
      vi.useRealTimers()
      server.closeAllConnections()
    }
  })

  it('fails incomplete scans at 20 pages instead of returning a partial artist set', async () => {
    respond = (url, res) => {
      const offset = Number(url.searchParams.get('offset'))
      json(res, {
        items: Array.from({ length: 50 }, () => artist('Repeated')),
        next: next(offset + 50),
      })
    }
    await expect(adapter().fetch({ playlistId: PLAYLIST_ID }, { limit: 2 })).rejects.toThrow(
      'incomplete',
    )
    expect(requests).toHaveLength(20)
  })
})
