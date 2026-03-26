// @vitest-environment node
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createBandcampClient } from '@/core/clients/bandcamp'

let server: http.Server
let baseUrl: string

// Sample current Bandcamp-like HTML with artist result items
const SAMPLE_HTML_TWO_BANDS = `
<!DOCTYPE html>
<html>
<body>
<ul class="result-items">
  <li class="searchresult data-search" data-search='{"type":"b","id":1}'>
    <div class="result-info">
      <div class="heading">
        <a href="https://portishead.bandcamp.com/album/live-at-roseland?from=search">Portishead</a>
      </div>
      <div class="itemurl">
        <a href="https://portishead.bandcamp.com/?from=search">https://portishead.bandcamp.com/?from=search</a>
      </div>
      <div class="itemtype">ARTIST</div>
      <div class="genre">genre: trip-hop</div>
      <img src="https://f4.bcbits.com/portishead_thumb.jpg" />
    </div>
  </li>
  <li class="searchresult data-search" data-search='{"type":"b","id":2}'>
    <div class="result-info">
      <div class="heading">
        <a href="https://massiveattack.bandcamp.com">Massive Attack</a>
      </div>
      <div class="itemurl">
        <a href="https://massiveattack.bandcamp.com/">https://massiveattack.bandcamp.com/</a>
      </div>
      <div class="genre">electronic</div>
    </div>
  </li>
</ul>
</body>
</html>
`

// HTML with a non-band result (album, itemtype=a) mixed in
const SAMPLE_HTML_MIXED = `
<ul>
  <li class="searchresult album" data-search='{"type":"a","id":10}'>
    <div class="result-info">
      <div class="heading"><a href="https://portishead.bandcamp.com/album/dummy">Dummy</a></div>
      <div class="itemtype">ALBUM</div>
    </div>
  </li>
  <li class="searchresult band" itemtype="b">
    <div class="result-info">
      <div class="heading"><a href="https://portishead.bandcamp.com">Portishead</a></div>
      <div class="genre">trip-hop</div>
    </div>
  </li>
</ul>
`

// HTML that looks like Bandcamp but has no results
const SAMPLE_HTML_EMPTY = `
<!DOCTYPE html>
<html><head><title>Bandcamp search</title></head>
<body><p>No results found</p></body>
</html>
`

let requestCount = 0

function sendHtml(res: http.ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'Content-Type': 'text/html' })
  res.end(body)
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    requestCount++
    const parsed = new URL(req.url ?? '/', 'http://localhost')

    if (parsed.pathname === '/search') {
      const q = parsed.searchParams.get('q') ?? ''

      if (q === 'error') {
        res.writeHead(500, { 'Content-Type': 'text/plain' })
        res.end('server error')
        return
      }

      if (q === 'empty') {
        sendHtml(res, 200, SAMPLE_HTML_EMPTY)
        return
      }

      if (q === 'mixed') {
        sendHtml(res, 200, SAMPLE_HTML_MIXED)
        return
      }

      sendHtml(res, 200, SAMPLE_HTML_TWO_BANDS)
      return
    }

    res.writeHead(404)
    res.end()
  })

  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const addr = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${addr.port}`
})

afterAll(() => {
  server.close()
})

describe('createBandcampClient', () => {
  describe('searchArtists(query, limit)', () => {
    it('parses artist results from current Bandcamp HTML', async () => {
      const client = createBandcampClient({ baseUrl })
      const results = await client.searchArtists('portishead')
      expect(results).toHaveLength(2)
      expect(results[0]).toMatchObject({
        name: 'Portishead',
        url: 'https://portishead.bandcamp.com',
        genre: 'trip-hop',
        imageUrl: 'https://f4.bcbits.com/portishead_thumb.jpg',
      })
    })

    it('normalizes item URLs and keeps genre and imageUrl optional', async () => {
      const client = createBandcampClient({ baseUrl })
      const results = await client.searchArtists('portishead')
      expect(results[1]).toMatchObject({
        name: 'Massive Attack',
        url: 'https://massiveattack.bandcamp.com',
        genre: 'electronic',
      })
      expect(results[1]?.imageUrl).toBeUndefined()
    })

    it('filters out non-band results (albums, tracks)', async () => {
      const client = createBandcampClient({ baseUrl })
      const results = await client.searchArtists('mixed')
      // Only the band result should appear, not the album
      expect(results).toHaveLength(1)
      expect(results[0]?.name).toBe('Portishead')
    })

    it('returns empty array when no results', async () => {
      const client = createBandcampClient({ baseUrl })
      const results = await client.searchArtists('empty')
      expect(results).toEqual([])
    })

    it('returns empty array on HTTP error (resilience)', async () => {
      const client = createBandcampClient({ baseUrl })
      const results = await client.searchArtists('error')
      expect(results).toEqual([])
    })

    it('returns empty array when server is unreachable (resilience)', async () => {
      const client = createBandcampClient({ baseUrl: 'http://127.0.0.1:1' })
      const results = await client.searchArtists('portishead')
      expect(results).toEqual([])
    })

    it('respects limit parameter', async () => {
      const client = createBandcampClient({ baseUrl })
      const results = await client.searchArtists('portishead', 1)
      expect(results).toHaveLength(1)
    })
  })

  describe('testConnection()', () => {
    it('returns success:true when server responds with HTML', async () => {
      const client = createBandcampClient({ baseUrl })
      const result = await client.testConnection()
      expect(result.success).toBe(true)
      expect(typeof result.message).toBe('string')
    })

    it('returns success:false when server is unreachable', async () => {
      const client = createBandcampClient({ baseUrl: 'http://127.0.0.1:1' })
      const result = await client.testConnection()
      expect(result.success).toBe(false)
    })

    it('returns success:false on HTTP 5xx', async () => {
      // testConnection uses q='test' which succeeds on the main mock server.
      // Stand up a dedicated 500-always server to verify the failure path.
      const errorServer = http.createServer((_req, res) => {
        res.writeHead(500)
        res.end('error')
      })
      await new Promise<void>((r) => errorServer.listen(0, '127.0.0.1', r))
      const addr = errorServer.address() as AddressInfo
      const errorClient = createBandcampClient({
        baseUrl: `http://127.0.0.1:${addr.port}`,
      })
      const result = await errorClient.testConnection()
      errorServer.close()
      expect(result.success).toBe(false)
    })
  })

  describe('rate limiting', () => {
    it('uses p-queue (concurrency 1) -- sequential calls do not interleave', async () => {
      // This is a structural test: just verifying the client can make multiple calls
      // without throwing (the queue ensures they serialize).
      const client = createBandcampClient({ baseUrl })
      const before = requestCount
      // Fire two calls -- they will queue up
      const [r1, r2] = await Promise.all([
        client.searchArtists('portishead'),
        client.searchArtists('portishead'),
      ])
      expect(r1.length).toBeGreaterThan(0)
      expect(r2.length).toBeGreaterThan(0)
      // Both requests hit the server
      expect(requestCount - before).toBe(2)
    }, 10_000)
  })

  describe('default baseUrl', () => {
    it('creates a client without options', () => {
      expect(() => createBandcampClient()).not.toThrow()
    })
  })
})
