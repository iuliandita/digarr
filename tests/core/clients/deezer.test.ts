// @vitest-environment node
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDeezerClient } from '@/core/clients/deezer'

let server: http.Server
let baseUrl: string

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(payload)
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const parsed = new URL(req.url ?? '/', `http://localhost`)
    const path = parsed.pathname

    const artistTopMatch = path.match(/^\/artist\/(\d+)\/top$/)
    if (artistTopMatch) {
      const artistId = Number(artistTopMatch[1])

      if (artistId === 999) {
        sendJson(res, 200, {
          data: [],
          error: { type: 'Exception', message: 'Artist not found', code: 800 },
        })
        return
      }

      if (artistId === 998) {
        sendJson(res, 200, { data: [] })
        return
      }

      sendJson(res, 200, {
        data: [
          {
            title: 'Glory Box',
            preview: 'https://cdns-preview.deezer.com/track/1.mp3',
            duration: 245,
          },
          {
            title: 'Sour Times',
            preview: 'https://cdns-preview.deezer.com/track/2.mp3',
            duration: 217,
          },
          { title: 'Roads', preview: '', duration: 303 },
        ],
      })
      return
    }

    if (path === '/search/artist') {
      const q = parsed.searchParams.get('q') ?? ''

      if (q === 'fail') {
        res.writeHead(500, { 'Content-Type': 'text/plain' })
        res.end('server error')
        return
      }

      if (q === 'apierror') {
        sendJson(res, 200, {
          data: [],
          error: { type: 'Exception', message: 'Service Unavailable', code: 700 },
        })
        return
      }

      sendJson(res, 200, {
        data: [
          {
            id: 1234,
            name: 'Portishead',
            nb_fan: 500000,
            picture_medium: 'https://cdn.deezer.com/portishead.jpg',
            link: 'https://www.deezer.com/artist/1234',
          },
          {
            id: 5678,
            name: 'Massive Attack',
            nb_fan: 750000,
            picture_medium: '',
            link: 'https://www.deezer.com/artist/5678',
          },
        ],
        total: 2,
      })
      return
    }

    if (path === '/search/track') {
      const q = parsed.searchParams.get('q') ?? ''

      if (q === 'trackfail') {
        res.writeHead(500, { 'Content-Type': 'text/plain' })
        res.end('server error')
        return
      }

      if (q === 'trackapierror') {
        sendJson(res, 200, {
          data: [],
          error: { type: 'Exception', message: 'Service Unavailable', code: 700 },
        })
        return
      }

      sendJson(res, 200, {
        data: [
          {
            id: 101,
            title: 'Creep',
            preview: 'https://cdns-preview.deezer.com/track/101.mp3',
            duration: 238,
            rank: 980000,
            artist: { name: 'Radiohead' },
          },
          {
            id: 102,
            title: 'Karma Police',
            preview: 'https://cdns-preview.deezer.com/track/102.mp3',
            duration: 262,
            rank: 920000,
            artist: { name: 'Radiohead' },
          },
        ],
        total: 2,
      })
      return
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('not found')
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${addr.port}`
})

afterAll(() => {
  server.close()
})

describe('createDeezerClient', () => {
  describe('searchArtists(query, limit)', () => {
    it('returns mapped DeezerSearchResult array on success', async () => {
      const client = createDeezerClient({ baseUrl })
      const results = await client.searchArtists('portishead')
      expect(results).toHaveLength(2)
      expect(results[0]).toEqual({
        id: 1234,
        name: 'Portishead',
        fans: 500000,
        imageUrl: 'https://cdn.deezer.com/portishead.jpg',
        url: 'https://www.deezer.com/artist/1234',
      })
    })

    it('omits imageUrl when picture_medium is empty string', async () => {
      const client = createDeezerClient({ baseUrl })
      const results = await client.searchArtists('portishead')
      expect(results[1]?.imageUrl).toBeUndefined()
    })

    it('returns correct shape with all required fields', async () => {
      const client = createDeezerClient({ baseUrl })
      const results = await client.searchArtists('test')
      for (const r of results) {
        expect(typeof r.id).toBe('number')
        expect(typeof r.name).toBe('string')
        expect(typeof r.fans).toBe('number')
        expect(typeof r.url).toBe('string')
      }
    })

    it('throws on HTTP error', async () => {
      const client = createDeezerClient({ baseUrl })
      await expect(client.searchArtists('fail')).rejects.toThrow()
    })

    it('throws when API returns error field', async () => {
      const client = createDeezerClient({ baseUrl })
      await expect(client.searchArtists('apierror')).rejects.toThrow(/Deezer API error/)
    })

    it('uses provided baseUrl', async () => {
      const client = createDeezerClient({ baseUrl })
      const results = await client.searchArtists('portishead')
      // Results returned from our mock server means baseUrl was used
      expect(results.length).toBeGreaterThan(0)
    })
  })

  describe('testConnection()', () => {
    it('returns success:true when search responds', async () => {
      const client = createDeezerClient({ baseUrl })
      const result = await client.testConnection()
      expect(result.success).toBe(true)
      expect(typeof result.message).toBe('string')
    })

    it('includes resultCount in details', async () => {
      const client = createDeezerClient({ baseUrl })
      const result = await client.testConnection()
      expect(result.details).toHaveProperty('resultCount')
    })

    it('returns success:false when server is unreachable', async () => {
      const client = createDeezerClient({ baseUrl: 'http://127.0.0.1:1' })
      const result = await client.testConnection()
      expect(result.success).toBe(false)
      expect(typeof result.message).toBe('string')
    })
  })

  describe('getArtistTopTracks(artistId, limit)', () => {
    it('returns top tracks for an artist', async () => {
      const client = createDeezerClient({ baseUrl })
      const tracks = await client.getArtistTopTracks(1234)
      expect(tracks).toHaveLength(3)
      expect(tracks[0]).toEqual({
        name: 'Glory Box',
        previewUrl: 'https://cdns-preview.deezer.com/track/1.mp3',
        durationMs: 245000,
      })
      expect(tracks[1]).toEqual({
        name: 'Sour Times',
        previewUrl: 'https://cdns-preview.deezer.com/track/2.mp3',
        durationMs: 217000,
      })
    })

    it('converts duration from seconds to milliseconds', async () => {
      const client = createDeezerClient({ baseUrl })
      const tracks = await client.getArtistTopTracks(1234)
      expect(tracks[0]?.durationMs).toBe(245 * 1000)
      expect(tracks[2]?.durationMs).toBe(303 * 1000)
    })

    it('omits previewUrl when preview is empty string', async () => {
      const client = createDeezerClient({ baseUrl })
      const tracks = await client.getArtistTopTracks(1234)
      expect(tracks[2]?.previewUrl).toBeUndefined()
    })

    it('returns empty array on API error', async () => {
      const client = createDeezerClient({ baseUrl })
      const tracks = await client.getArtistTopTracks(999)
      expect(tracks).toEqual([])
    })

    it('returns empty array when data is empty', async () => {
      const client = createDeezerClient({ baseUrl })
      const tracks = await client.getArtistTopTracks(998)
      expect(tracks).toEqual([])
    })

    it('returns empty array when server is unreachable', async () => {
      const client = createDeezerClient({ baseUrl: 'http://127.0.0.1:1' })
      const tracks = await client.getArtistTopTracks(1234)
      expect(tracks).toEqual([])
    })
  })

  describe('searchTracks(query, limit)', () => {
    it('returns mapped track search results on success', async () => {
      const client = createDeezerClient({ baseUrl })
      const results = await client.searchTracks('artist:"Radiohead"', 2)

      expect(results).toEqual([
        { id: '101', name: 'Creep', artists: ['Radiohead'], rank: 980000 },
        { id: '102', name: 'Karma Police', artists: ['Radiohead'], rank: 920000 },
      ])
    })

    it('throws on HTTP error', async () => {
      const client = createDeezerClient({ baseUrl })
      await expect(client.searchTracks('trackfail')).rejects.toThrow()
    })

    it('throws when API returns error field', async () => {
      const client = createDeezerClient({ baseUrl })
      await expect(client.searchTracks('trackapierror')).rejects.toThrow(/Deezer API error/)
    })
  })

  describe('default baseUrl', () => {
    it('creates a client without options', () => {
      expect(() => createDeezerClient()).not.toThrow()
    })

    it('creates a client with empty options', () => {
      expect(() => createDeezerClient({})).not.toThrow()
    })
  })
})
