// @vitest-environment node
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSpotifyLikedSongsAdapter } from '@/core/subscriptions/adapters/spotify-liked-songs'

let server: http.Server
let baseUrl: string
let requestCount = 0

beforeAll(async () => {
  server = http.createServer((req, res) => {
    requestCount++
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const offset = Number(url.searchParams.get('offset') ?? '0')

    res.writeHead(200, { 'Content-Type': 'application/json' })
    if (offset === 0) {
      res.end(
        JSON.stringify({
          items: [
            { track: { artists: [{ name: 'Artist One', id: 'a1' }] } },
            { track: { artists: [{ name: 'Artist Two', id: 'a2' }] } },
            { track: { artists: [{ name: 'artist one', id: 'a1' }] } },
          ],
          next: `${baseUrl}/me/tracks?limit=2&offset=2`,
        }),
      )
      return
    }

    res.end(
      JSON.stringify({
        items: [{ track: { artists: [{ name: 'Artist Three', id: 'a3' }] } }],
        next: null,
      }),
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${addr.port}`
})

afterAll(() => {
  server.close()
})

describe('createSpotifyLikedSongsAdapter', () => {
  it('has correct type and label', () => {
    const adapter = createSpotifyLikedSongsAdapter({ getToken: async () => 'tok', baseUrl })
    expect(adapter.type).toBe('spotify-liked-songs')
    expect(adapter.label).toBe('Spotify Liked Songs')
    expect(adapter.configFields).toEqual([])
  })

  it('fetches liked-song artists across pages and deduplicates them', async () => {
    requestCount = 0
    const adapter = createSpotifyLikedSongsAdapter({ getToken: async () => 'tok', baseUrl })
    const result = await adapter.fetch({}, { limit: 3 })

    expect(requestCount).toBe(2)
    expect(result.artists).toHaveLength(3)
    expect(result.artists.map((artist) => artist.name)).toEqual([
      'Artist One',
      'Artist Two',
      'Artist Three',
    ])
  })

  it('sets the expected source metadata', async () => {
    const adapter = createSpotifyLikedSongsAdapter({ getToken: async () => 'tok', baseUrl })
    const result = await adapter.fetch({}, { limit: 1 })

    expect(result.artists[0]).toMatchObject({
      source: 'spotify-liked-songs',
      sourceUrl: 'https://open.spotify.com/collection/tracks',
      similarityScore: 0.85,
    })
  })
})
