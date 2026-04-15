// @vitest-environment node
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createLastfmChartsAdapter } from '@/core/subscriptions/adapters/lastfm-charts'

let server: http.Server
let baseUrl: string

const fixtureResponse = {
  artists: {
    artist: [
      { name: 'Top Artist A', mbid: 'mbid-a', listeners: '5000000' },
      { name: 'Top Artist B', mbid: 'mbid-b', listeners: '800000' },
      { name: 'Top Artist C', mbid: '', listeners: '0' },
      { name: 'top artist a', mbid: 'mbid-a', listeners: '5000000' }, // duplicate
    ],
  },
}

const originalFetch = global.fetch

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1`)
    if (url.searchParams.get('method') === 'chart.gettopartists') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(fixtureResponse))
      return
    }
    res.writeHead(404)
    res.end('{}')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${addr.port}`

  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('ws.audioscrobbler.com')) {
      const parsed = new URL(url)
      const mockUrl = `${baseUrl}${parsed.pathname}${parsed.search}`
      return originalFetch(mockUrl, init)
    }
    return originalFetch(input, init)
  }) as typeof fetch
})

afterAll(() => {
  server.close()
  global.fetch = originalFetch
})

describe('createLastfmChartsAdapter', () => {
  function requireArtist<T>(value: T | undefined, message: string): T {
    if (value === undefined) {
      throw new Error(message)
    }
    return value
  }

  it('has correct type and label', () => {
    const adapter = createLastfmChartsAdapter({ apiKey: 'testkey' })
    expect(adapter.type).toBe('lastfm-charts')
    expect(adapter.label).toBeTruthy()
  })

  it('has no configFields (period param not supported by Last.fm chart API)', () => {
    const adapter = createLastfmChartsAdapter({ apiKey: 'testkey' })
    expect(adapter.configFields).toHaveLength(0)
  })

  it('fetches artists and deduplicates by lowercase name', async () => {
    const adapter = createLastfmChartsAdapter({ apiKey: 'testkey' })
    const result = await adapter.fetch({})

    // A, B, C - lowercase dupe of A filtered
    expect(result.artists).toHaveLength(3)
    const names = result.artists.map((a) => a.name)
    expect(names).toContain('Top Artist A')
    expect(names).toContain('Top Artist B')
    expect(names).toContain('Top Artist C')
  })

  it('sets correct source tag', async () => {
    const adapter = createLastfmChartsAdapter({ apiKey: 'testkey' })
    const result = await adapter.fetch({})
    const firstArtist = requireArtist(result.artists[0], 'Expected first chart artist')
    expect(firstArtist.source).toBe('lastfm-charts')
  })

  it('normalizes listener count to similarityScore', async () => {
    const adapter = createLastfmChartsAdapter({ apiKey: 'testkey' })
    const result = await adapter.fetch({})

    // 5_000_000 / 1_000_000 = 5.0 capped at 1.0
    const artistA = requireArtist(
      result.artists.find((a) => a.name === 'Top Artist A'),
      'Expected Top Artist A',
    )
    expect(artistA.similarityScore).toBe(1.0)
    // 800_000 / 1_000_000 = 0.8
    const artistB = requireArtist(
      result.artists.find((a) => a.name === 'Top Artist B'),
      'Expected Top Artist B',
    )
    expect(artistB.similarityScore).toBeCloseTo(0.8)
    // 0 listeners -> 0.5 default
    const artistC = requireArtist(
      result.artists.find((a) => a.name === 'Top Artist C'),
      'Expected Top Artist C',
    )
    expect(artistC.similarityScore).toBe(0.5)
  })

  it('sets mbid when present', async () => {
    const adapter = createLastfmChartsAdapter({ apiKey: 'testkey' })
    const result = await adapter.fetch({})

    const artistA = requireArtist(
      result.artists.find((a) => a.name === 'Top Artist A'),
      'Expected Top Artist A',
    )
    expect(artistA.mbid).toBe('mbid-a')

    const artistC = requireArtist(
      result.artists.find((a) => a.name === 'Top Artist C'),
      'Expected Top Artist C',
    )
    expect(artistC.mbid).toBeUndefined()
  })

  it('handles empty chart response', async () => {
    const emptyServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ artists: { artist: [] } }))
    })
    await new Promise<void>((r) => emptyServer.listen(0, '127.0.0.1', r))
    const emptyAddr = emptyServer.address() as AddressInfo
    const emptyBase = `http://127.0.0.1:${emptyAddr.port}`

    const savedFetch = global.fetch
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('ws.audioscrobbler.com')) {
        const parsed = new URL(url)
        return originalFetch(`${emptyBase}${parsed.pathname}${parsed.search}`, init)
      }
      return originalFetch(input, init)
    }) as typeof fetch

    const adapter = createLastfmChartsAdapter({ apiKey: 'testkey' })
    const result = await adapter.fetch({})
    expect(result.artists).toHaveLength(0)

    global.fetch = savedFetch
    emptyServer.close()
  })
})
