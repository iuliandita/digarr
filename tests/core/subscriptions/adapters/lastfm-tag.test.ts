// @vitest-environment node
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createLastfmTagAdapter } from '@/core/subscriptions/adapters/lastfm-tag'

let server: http.Server
let baseUrl: string

const fixtureResponse = {
  topartists: {
    artist: [
      { name: 'Metal Artist A', mbid: 'mbid-a', listeners: '2000000' },
      { name: 'Metal Artist B', mbid: '', listeners: '500000' },
      { name: 'Metal Artist C', mbid: 'mbid-c', listeners: '0' },
      { name: 'metal artist a', mbid: 'mbid-a', listeners: '2000000' }, // duplicate
    ],
  },
}

function makeAdapter() {
  return createLastfmTagAdapter({
    apiKey: 'testkey',
    // Patch fetch URL via global - we'll use a custom approach instead
  })
}

// We patch global fetch to intercept Last.fm requests
const originalFetch = global.fetch

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1`)
    if (url.searchParams.get('method') === 'tag.gettopartists') {
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

  // Redirect Last.fm API calls to the mock server
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

describe('createLastfmTagAdapter', () => {
  function requireArtist<T>(value: T | undefined, message: string): T {
    if (value === undefined) {
      throw new Error(message)
    }
    return value
  }

  it('has correct type and label', () => {
    const adapter = makeAdapter()
    expect(adapter.type).toBe('lastfm-tag')
    expect(adapter.label).toBeTruthy()
  })

  it('has tag configField', () => {
    const adapter = makeAdapter()
    const keys = adapter.configFields.map((f) => f.key)
    expect(keys).toContain('tag')
  })

  it('fetches artists and deduplicates by lowercase name', async () => {
    const adapter = makeAdapter()
    const result = await adapter.fetch({ tag: 'metal' })

    // A, B, C - lowercase dupe of A filtered
    expect(result.artists).toHaveLength(3)
    const names = result.artists.map((a) => a.name)
    expect(names).toContain('Metal Artist A')
    expect(names).toContain('Metal Artist B')
    expect(names).toContain('Metal Artist C')
  })

  it('sets correct source tag', async () => {
    const adapter = makeAdapter()
    const result = await adapter.fetch({ tag: 'metal' })
    const firstArtist = requireArtist(result.artists[0], 'Expected first tag artist')
    expect(firstArtist.source).toBe('lastfm-tag:metal')
  })

  it('normalizes listener count to similarityScore', async () => {
    const adapter = makeAdapter()
    const result = await adapter.fetch({ tag: 'metal' })

    // 2_000_000 / 1_000_000 = 2.0 capped at 1.0
    const artistA = requireArtist(
      result.artists.find((a) => a.name === 'Metal Artist A'),
      'Expected Metal Artist A',
    )
    expect(artistA.similarityScore).toBe(1.0)
    // 500_000 / 1_000_000 = 0.5
    const artistB = requireArtist(
      result.artists.find((a) => a.name === 'Metal Artist B'),
      'Expected Metal Artist B',
    )
    expect(artistB.similarityScore).toBeCloseTo(0.5)
    // 0 listeners -> 0.5 default
    const artistC = requireArtist(
      result.artists.find((a) => a.name === 'Metal Artist C'),
      'Expected Metal Artist C',
    )
    expect(artistC.similarityScore).toBe(0.5)
  })

  it('sets mbid when present', async () => {
    const adapter = makeAdapter()
    const result = await adapter.fetch({ tag: 'metal' })

    const artistA = requireArtist(
      result.artists.find((a) => a.name === 'Metal Artist A'),
      'Expected Metal Artist A',
    )
    expect(artistA.mbid).toBe('mbid-a')

    const artistB = requireArtist(
      result.artists.find((a) => a.name === 'Metal Artist B'),
      'Expected Metal Artist B',
    )
    expect(artistB.mbid).toBeUndefined()
  })

  it('returns empty when tag is missing', async () => {
    const adapter = makeAdapter()
    const result = await adapter.fetch({})
    expect(result.artists).toHaveLength(0)
  })

  it('handles empty artist list', async () => {
    const emptyServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ topartists: { artist: [] } }))
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

    const adapter = makeAdapter()
    const result = await adapter.fetch({ tag: 'emptytag' })
    expect(result.artists).toHaveLength(0)

    global.fetch = savedFetch
    emptyServer.close()
  })
})
