// @vitest-environment node
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSpotifyPlaylistAdapter } from '@/core/subscriptions/adapters/spotify-playlist'

let server: http.Server
let baseUrl: string

const PLAYLIST_ID = 'testPlaylist123'

const fixtureResponse = {
  tracks: {
    items: [
      { track: { artists: [{ name: 'Artist Alpha', id: 'sp1' }] } },
      {
        track: {
          artists: [
            { name: 'Artist Beta', id: 'sp2' },
            { name: 'Artist Gamma', id: 'sp3' },
          ],
        },
      },
      { track: { artists: [{ name: 'artist alpha', id: 'sp1' }] } }, // duplicate (different case)
      { track: null }, // null track
    ],
  },
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url?.includes(`/playlists/${PLAYLIST_ID}`)) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(fixtureResponse))
      return
    }
    res.writeHead(404)
    res.end('{"error":"not found"}')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${addr.port}`
})

afterAll(() => {
  server.close()
})

describe('createSpotifyPlaylistAdapter', () => {
  function requireArtist<T>(value: T | undefined, message: string): T {
    if (value === undefined) {
      throw new Error(message)
    }
    return value
  }

  it('has correct type and label', () => {
    const adapter = createSpotifyPlaylistAdapter({ getToken: async () => 'tok', baseUrl })
    expect(adapter.type).toBe('spotify-playlist')
    expect(adapter.label).toBeTruthy()
  })

  it('has playlistId configField', () => {
    const adapter = createSpotifyPlaylistAdapter({ getToken: async () => 'tok', baseUrl })
    const keys = adapter.configFields.map((f) => f.key)
    expect(keys).toContain('playlistId')
  })

  it('fetches artists and deduplicates by lowercase name', async () => {
    const adapter = createSpotifyPlaylistAdapter({ getToken: async () => 'tok', baseUrl })
    const result = await adapter.fetch({ playlistId: PLAYLIST_ID })

    // Alpha, Beta, Gamma - lowercase duplicate of Alpha filtered out
    expect(result.artists).toHaveLength(3)
    const names = result.artists.map((a) => a.name)
    expect(names).toContain('Artist Alpha')
    expect(names).toContain('Artist Beta')
    expect(names).toContain('Artist Gamma')
  })

  it('sets correct source tag and sourceUrl', async () => {
    const adapter = createSpotifyPlaylistAdapter({ getToken: async () => 'tok', baseUrl })
    const result = await adapter.fetch({ playlistId: PLAYLIST_ID })

    const firstArtist = requireArtist(result.artists[0], 'Expected first playlist artist')
    expect(firstArtist.source).toBe(`spotify-playlist:${PLAYLIST_ID}`)
    expect(firstArtist.sourceUrl).toBe(`https://open.spotify.com/playlist/${PLAYLIST_ID}`)
  })

  it('sets similarityScore 0.7 for all artists', async () => {
    const adapter = createSpotifyPlaylistAdapter({ getToken: async () => 'tok', baseUrl })
    const result = await adapter.fetch({ playlistId: PLAYLIST_ID })

    for (const artist of result.artists) {
      expect(artist.similarityScore).toBe(0.7)
    }
  })

  it('returns empty when playlistId is missing', async () => {
    const adapter = createSpotifyPlaylistAdapter({ getToken: async () => 'tok', baseUrl })
    const result = await adapter.fetch({})
    expect(result.artists).toHaveLength(0)
  })

  it('extracts playlist ID from full Spotify URL', async () => {
    const adapter = createSpotifyPlaylistAdapter({ getToken: async () => 'tok', baseUrl })
    const result = await adapter.fetch({
      playlistId: `https://open.spotify.com/playlist/${PLAYLIST_ID}?si=abc`,
    })
    expect(result.artists.length).toBeGreaterThan(0)
    const firstArtist = requireArtist(result.artists[0], 'Expected first playlist artist')
    expect(firstArtist.source).toBe(`spotify-playlist:${PLAYLIST_ID}`)
  })

  it('extracts playlist ID from spotify URI', async () => {
    const adapter = createSpotifyPlaylistAdapter({ getToken: async () => 'tok', baseUrl })
    const result = await adapter.fetch({ playlistId: `spotify:playlist:${PLAYLIST_ID}` })
    expect(result.artists.length).toBeGreaterThan(0)
  })

  it('handles empty tracks gracefully', async () => {
    const emptyServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ tracks: { items: [] } }))
    })
    await new Promise<void>((r) => emptyServer.listen(0, '127.0.0.1', r))
    const emptyAddr = emptyServer.address() as AddressInfo
    const emptyBase = `http://127.0.0.1:${emptyAddr.port}`

    const adapter = createSpotifyPlaylistAdapter({
      getToken: async () => 'tok',
      baseUrl: emptyBase,
    })
    const result = await adapter.fetch({ playlistId: 'anyid' })
    expect(result.artists).toHaveLength(0)

    emptyServer.close()
  })

  it('throws on non-200 response', async () => {
    const errServer = http.createServer((_req, res) => {
      res.writeHead(401)
      res.end('{"error":"Unauthorized"}')
    })
    await new Promise<void>((r) => errServer.listen(0, '127.0.0.1', r))
    const errAddr = errServer.address() as AddressInfo
    const errBase = `http://127.0.0.1:${errAddr.port}`

    const adapter = createSpotifyPlaylistAdapter({ getToken: async () => 'tok', baseUrl: errBase })
    await expect(adapter.fetch({ playlistId: 'anyid' })).rejects.toThrow('401')

    errServer.close()
  })
})
