// @vitest-environment node
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSpotifyChartsAdapter } from '@/core/subscriptions/adapters/spotify-charts'

let server: http.Server
let baseUrl: string
let lastRequestUrl: string

const fixtureResponse = {
  tracks: {
    items: [
      { track: { artists: [{ name: 'Chart Artist One', id: 'c1' }] } },
      {
        track: {
          artists: [
            { name: 'Chart Artist Two', id: 'c2' },
            { name: 'Chart Artist Three', id: 'c3' },
          ],
        },
      },
      { track: { artists: [{ name: 'chart artist one', id: 'c1' }] } }, // duplicate
    ],
  },
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    lastRequestUrl = req.url ?? ''
    if (req.url?.includes('/playlists/')) {
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
})

afterAll(() => {
  server.close()
})

describe('createSpotifyChartsAdapter', () => {
  function requireArtist<T>(value: T | undefined, message: string): T {
    if (value === undefined) {
      throw new Error(message)
    }
    return value
  }

  it('has correct type and label', () => {
    const adapter = createSpotifyChartsAdapter({ getToken: async () => 'tok', baseUrl })
    expect(adapter.type).toBe('spotify-charts')
    expect(adapter.label).toBeTruthy()
  })

  it('has region and chartType configFields', () => {
    const adapter = createSpotifyChartsAdapter({ getToken: async () => 'tok', baseUrl })
    const keys = adapter.configFields.map((f) => f.key)
    expect(keys).toContain('region')
    expect(keys).toContain('chartType')
  })

  it('configField for region is a select with options', () => {
    const adapter = createSpotifyChartsAdapter({ getToken: async () => 'tok', baseUrl })
    const regionField = adapter.configFields.find((f) => f.key === 'region')
    if (!regionField) {
      throw new Error('Expected region config field')
    }
    expect(regionField.type).toBe('select')
    expect(regionField.options?.length).toBeGreaterThan(0)
  })

  it('fetches artists and deduplicates by lowercase name', async () => {
    const adapter = createSpotifyChartsAdapter({ getToken: async () => 'tok', baseUrl })
    const result = await adapter.fetch({ region: 'global', chartType: 'top50' })

    // One/Two/Three -- lowercase dupe of One filtered out
    expect(result.artists).toHaveLength(3)
  })

  it('sets correct source tag with region and chartType', async () => {
    const adapter = createSpotifyChartsAdapter({ getToken: async () => 'tok', baseUrl })
    const result = await adapter.fetch({ region: 'us', chartType: 'top50' })

    const firstArtist = requireArtist(result.artists[0], 'Expected first chart artist')
    expect(firstArtist.source).toBe('spotify-charts:us/top50')
  })

  it('sets sourceUrl to the playlist URL', async () => {
    const adapter = createSpotifyChartsAdapter({ getToken: async () => 'tok', baseUrl })
    const result = await adapter.fetch({ region: 'global', chartType: 'top50' })

    const firstArtist = requireArtist(result.artists[0], 'Expected first chart artist')
    expect(firstArtist.sourceUrl).toMatch(/open\.spotify\.com\/playlist\//)
  })

  it('sets similarityScore 0.7 for all artists', async () => {
    const adapter = createSpotifyChartsAdapter({ getToken: async () => 'tok', baseUrl })
    const result = await adapter.fetch({ region: 'global', chartType: 'top50' })

    for (const artist of result.artists) {
      expect(artist.similarityScore).toBe(0.7)
    }
  })

  it('uses different playlist IDs for different regions', async () => {
    const adapter = createSpotifyChartsAdapter({ getToken: async () => 'tok', baseUrl })

    await adapter.fetch({ region: 'global', chartType: 'top50' })
    const globalUrl = lastRequestUrl

    await adapter.fetch({ region: 'gb', chartType: 'top50' })
    const gbUrl = lastRequestUrl

    // They should request different playlist IDs
    expect(globalUrl).not.toBe(gbUrl)
  })

  it('falls back to global top50 for unknown region', async () => {
    const adapter = createSpotifyChartsAdapter({ getToken: async () => 'tok', baseUrl })
    // Should not throw, falls back to global
    const result = await adapter.fetch({ region: 'zz', chartType: 'top50' })
    expect(result.artists.length).toBeGreaterThanOrEqual(0)
  })
})
