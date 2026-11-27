// @vitest-environment node
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createItunesClient } from '@/core/clients/itunes'

const CLIP = 'https://audio-ssl.itunes.apple.com/itunes-assets/a/b/preview.m4a'

type Reply = { status?: number; body?: unknown; delayMs?: number; headers?: Record<string, string> }

let server: http.Server
let baseUrl: string
let requests: string[] = []
let replies: { search: Reply; lookup: Reply }

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? '/'
    requests.push(url)
    const reply = url.startsWith('/search') ? replies.search : replies.lookup
    setTimeout(() => {
      res.writeHead(reply.status ?? 200, {
        'Content-Type': 'text/javascript; charset=utf-8',
        ...reply.headers,
      })
      res.end(JSON.stringify(reply.body ?? { results: [] }))
    }, reply.delayMs ?? 0)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => {
  server.close()
})

beforeEach(() => {
  requests = []
  replies = { search: {}, lookup: {} }
})

const artist = (artistName: string, artistId: number) => ({
  wrapperType: 'artist',
  artistName,
  artistId,
})
const song = (trackId: number, extra: Record<string, unknown> = {}) => ({
  wrapperType: 'track',
  kind: 'song',
  trackId,
  trackName: `Song ${trackId}`,
  artistName: 'Nirvana',
  previewUrl: CLIP,
  collectionName: 'Not forwarded',
  ...extra,
})

describe('iTunes client', () => {
  it('looks songs up by artist ID without searching', async () => {
    replies.lookup = { body: { results: [artist('Nirvana', 112018), song(1), song(2)] } }
    const lookup = await createItunesClient({ baseUrl }).lookupSongs({
      artistName: 'Nirvana',
      artistId: '112018',
    })
    expect(lookup).toEqual({
      songs: [
        { trackId: 1, trackName: 'Song 1', artistName: 'Nirvana', previewUrl: CLIP },
        { trackId: 2, trackName: 'Song 2', artistName: 'Nirvana', previewUrl: CLIP },
      ],
    })
    expect(requests).toEqual(['/lookup?id=112018&entity=song&limit=10'])
  })

  it('uses a name search only when exactly one artist has exactly that name', async () => {
    replies.search = {
      body: {
        results: [artist('Radiohead Tribute', 1), artist('  RADIOHEAD ', 657515), artist('x', 2)],
      },
    }
    replies.lookup = { body: { results: [song(7)] } }
    const lookup = await createItunesClient({ baseUrl }).lookupSongs({ artistName: 'Radiohead' })
    expect(lookup.songs?.map((s) => s.trackId)).toEqual([7])
    expect(requests).toEqual([
      '/search?term=Radiohead&media=music&entity=musicArtist&attribute=artistTerm&limit=25',
      '/lookup?id=657515&entity=song&limit=10',
    ])
  })

  it('refuses a name shared by several artists (five artists called Nirvana)', async () => {
    replies.search = {
      body: {
        results: [
          artist('Nirvana', 112018),
          artist('Nirvana', 1053245),
          artist('nirvana', 434474),
          artist('NIRVANA', 1501183),
          artist('Nirvana ', 1440802),
          artist('Nirvana Tribute Band', 9),
        ],
      },
    }
    const lookup = await createItunesClient({ baseUrl }).lookupSongs({ artistName: 'Nirvana' })
    expect(lookup).toEqual({ songs: null, reason: 'no-match' })
    expect(requests).toHaveLength(1)
  })

  it('counts one artist listed twice as one match', async () => {
    replies.search = { body: { results: [artist('Nirvana', 112018), artist('Nirvana', 112018)] } }
    replies.lookup = { body: { results: [song(1)] } }
    const lookup = await createItunesClient({ baseUrl }).lookupSongs({ artistName: 'Nirvana' })
    expect(lookup.songs).toHaveLength(1)
  })

  it('does not guess when no artist has exactly that name', async () => {
    replies.search = { body: { results: [artist('Yorushika', 2)] } }
    const lookup = await createItunesClient({ baseUrl }).lookupSongs({ artistName: 'ヨルシカ' })
    expect(lookup).toEqual({ songs: null, reason: 'no-match' })
    expect(requests).toHaveLength(1)
  })

  it('keeps only songs with a track ID, and only clips from the Apple preview host', async () => {
    replies.lookup = {
      body: {
        results: [
          song(1, { previewUrl: 'https://evil.example/preview.m4a' }),
          song(2, { previewUrl: 'http://audio-ssl.itunes.apple.com/p.m4a' }),
          song(3, { trackName: 42, artistName: null }),
          { ...song(4), kind: 'music-video' },
          { ...song(5), trackId: '5' },
          song(6),
        ],
      },
    }
    const lookup = await createItunesClient({ baseUrl }).lookupSongs({
      artistName: 'Nirvana',
      artistId: '1',
    })
    expect(lookup.songs).toEqual([
      { trackId: 1, trackName: 'Song 1', artistName: 'Nirvana' },
      { trackId: 2, trackName: 'Song 2', artistName: 'Nirvana' },
      { trackId: 3, previewUrl: CLIP },
      { trackId: 6, trackName: 'Song 6', artistName: 'Nirvana', previewUrl: CLIP },
    ])
  })

  it('reports no-match when the artist has no songs', async () => {
    replies.lookup = { body: { results: [artist('Nirvana', 1)] } }
    expect(
      await createItunesClient({ baseUrl }).lookupSongs({ artistName: 'Nirvana', artistId: '1' }),
    ).toEqual({ songs: null, reason: 'no-match' })
  })

  it.each<[string, Reply]>([
    ['an error status', { status: 503 }],
    ['a body without results', { body: { errorMessage: 'nope' } }],
    ['a redirect', { status: 302, headers: { Location: 'https://example.com/' } }],
  ])('reports lookup-failed on %s', async (_case, reply) => {
    replies.lookup = reply
    expect(
      await createItunesClient({ baseUrl }).lookupSongs({ artistName: 'Nirvana', artistId: '1' }),
    ).toEqual({ songs: null, reason: 'lookup-failed' })
    expect(requests).toHaveLength(1)
  })

  it('gives up when Apple is slower than the lookup budget', async () => {
    replies.lookup = { delayMs: 500, body: { results: [song(1)] } }
    expect(
      await createItunesClient({ baseUrl, budgetMs: 100 }).lookupSongs({
        artistName: 'Nirvana',
        artistId: '1',
      }),
    ).toEqual({ songs: null, reason: 'lookup-failed' })
  })

  it('ignores an artist ID that is not purely numeric and searches by name instead', async () => {
    replies.search = { body: { results: [] } }
    await createItunesClient({ baseUrl }).lookupSongs({ artistName: 'Nirvana', artistId: '1&x=2' })
    expect(requests).toEqual([
      '/search?term=Nirvana&media=music&entity=musicArtist&attribute=artistTerm&limit=25',
    ])
  })

  it('caches answers but not failures', async () => {
    let clock = 0
    const client = createItunesClient({ baseUrl, now: () => clock })
    replies.lookup = { status: 500 }
    await client.lookupSongs({ artistName: 'Nirvana', artistId: '1' })
    replies.lookup = { body: { results: [song(1)] } }
    expect((await client.lookupSongs({ artistName: 'Nirvana', artistId: '1' })).songs).toHaveLength(
      1,
    )
    expect((await client.lookupSongs({ artistName: 'Nirvana', artistId: '1' })).songs).toHaveLength(
      1,
    )
    expect(requests).toHaveLength(2)

    clock += 7 * 60 * 60 * 1000
    await client.lookupSongs({ artistName: 'Nirvana', artistId: '1' })
    expect(requests).toHaveLength(3)
  })
})
