// @vitest-environment node
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createListenBrainzAdapter } from '@/core/subscriptions/adapters/listenbrainz'

let server: http.Server
let baseUrl: string

const freshReleasesFixture = {
  payload: {
    releases: [
      { artist_credit_name: 'Artist One', release_mbid: 'rel-1' },
      { artist_credit_name: 'Artist Two', release_mbid: 'rel-2' },
      { artist_credit_name: 'artist one', release_mbid: 'rel-3' }, // duplicate
      { artist_credit_name: 'Artist Three', release_mbid: 'rel-4' },
      { release_mbid: 'rel-5' }, // missing artist name
    ],
  },
}

const weeklyJamsFixture = {
  playlists: [
    {
      playlist: {
        title: 'Exploration Playlist for testuser - 2024-01-01',
        track: [
          { creator: 'Jam Artist A', title: 'Song 1' },
          { creator: 'Jam Artist B', title: 'Song 2' },
        ],
      },
    },
    {
      playlist: {
        title: 'Weekly Jams for testuser - 2024-01-01',
        track: [
          { creator: 'Jam Artist X', title: 'Track 1' },
          { creator: 'Jam Artist Y', title: 'Track 2' },
          { creator: 'jam artist x', title: 'Track 3' }, // duplicate
          { creator: 'Jam Artist Z', title: 'Track 4' },
          { title: 'Track 5' }, // missing creator
        ],
      },
    },
  ],
}

const originalFetch = global.fetch

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? ''

    if (url.includes('/explore/fresh-releases')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(freshReleasesFixture))
      return
    }

    if (url.includes('/playlists')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(weeklyJamsFixture))
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
    if (url.includes('api.listenbrainz.org')) {
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

describe('createListenBrainzAdapter', () => {
  function requireArtist<T>(value: T | undefined, message: string): T {
    if (value === undefined) {
      throw new Error(message)
    }
    return value
  }

  it('has correct type and label', () => {
    const adapter = createListenBrainzAdapter({ username: 'testuser', token: 'testtoken' })
    expect(adapter.type).toBe('listenbrainz')
    expect(adapter.label).toBeTruthy()
  })

  it('has feedType configField as select', () => {
    const adapter = createListenBrainzAdapter({ username: 'testuser', token: 'testtoken' })
    const feedTypeField = adapter.configFields.find((f) => f.key === 'feedType')
    expect(feedTypeField).toBeTruthy()
    if (!feedTypeField) {
      throw new Error('Expected feedType config field')
    }
    expect(feedTypeField.type).toBe('select')
    const values = feedTypeField.options?.map((o) => o.value) ?? []
    expect(values).toContain('fresh-releases')
    expect(values).toContain('weekly-jams')
  })

  describe('fresh-releases', () => {
    it('fetches artists and deduplicates by lowercase name', async () => {
      const adapter = createListenBrainzAdapter({ username: 'testuser', token: 'testtoken' })
      const result = await adapter.fetch({ feedType: 'fresh-releases' })

      // One, Two, Three -- duplicate of One filtered, missing artist skipped
      expect(result.artists).toHaveLength(3)
      const names = result.artists.map((a) => a.name)
      expect(names).toContain('Artist One')
      expect(names).toContain('Artist Two')
      expect(names).toContain('Artist Three')
    })

    it('sets correct source tag', async () => {
      const adapter = createListenBrainzAdapter({ username: 'testuser', token: 'testtoken' })
      const result = await adapter.fetch({ feedType: 'fresh-releases' })
      const firstArtist = requireArtist(result.artists[0], 'Expected first fresh-release artist')
      expect(firstArtist.source).toBe('listenbrainz:fresh-releases')
    })

    it('sets similarityScore 0.6', async () => {
      const adapter = createListenBrainzAdapter({ username: 'testuser', token: 'testtoken' })
      const result = await adapter.fetch({ feedType: 'fresh-releases' })
      for (const artist of result.artists) {
        expect(artist.similarityScore).toBe(0.6)
      }
    })
  })

  describe('weekly-jams', () => {
    it('extracts artists from the Weekly Jams playlist', async () => {
      const adapter = createListenBrainzAdapter({ username: 'testuser', token: 'testtoken' })
      const result = await adapter.fetch({ feedType: 'weekly-jams' })

      // X, Y, Z -- duplicate of X filtered, missing creator skipped
      expect(result.artists).toHaveLength(3)
      const names = result.artists.map((a) => a.name)
      expect(names).toContain('Jam Artist X')
      expect(names).toContain('Jam Artist Y')
      expect(names).toContain('Jam Artist Z')
    })

    it('sets correct source tag', async () => {
      const adapter = createListenBrainzAdapter({ username: 'testuser', token: 'testtoken' })
      const result = await adapter.fetch({ feedType: 'weekly-jams' })
      const firstArtist = requireArtist(result.artists[0], 'Expected first weekly-jams artist')
      expect(firstArtist.source).toBe('listenbrainz:weekly-jams')
    })

    it('ignores non-Weekly-Jams playlists', async () => {
      const adapter = createListenBrainzAdapter({ username: 'testuser', token: 'testtoken' })
      const result = await adapter.fetch({ feedType: 'weekly-jams' })

      // Should NOT contain artists from the Exploration playlist
      const names = result.artists.map((a) => a.name)
      expect(names).not.toContain('Jam Artist A')
      expect(names).not.toContain('Jam Artist B')
    })

    it('sets similarityScore 0.6', async () => {
      const adapter = createListenBrainzAdapter({ username: 'testuser', token: 'testtoken' })
      const result = await adapter.fetch({ feedType: 'weekly-jams' })
      for (const artist of result.artists) {
        expect(artist.similarityScore).toBe(0.6)
      }
    })
  })

  it('returns empty for unknown feedType', async () => {
    const adapter = createListenBrainzAdapter({ username: 'testuser', token: 'testtoken' })
    const result = await adapter.fetch({ feedType: 'unknown-feed' })
    expect(result.artists).toHaveLength(0)
  })

  it('handles empty fresh-releases response', async () => {
    const emptyServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ payload: { releases: [] } }))
    })
    await new Promise<void>((r) => emptyServer.listen(0, '127.0.0.1', r))
    const emptyAddr = emptyServer.address() as AddressInfo
    const emptyBase = `http://127.0.0.1:${emptyAddr.port}`

    const savedFetch = global.fetch
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('api.listenbrainz.org')) {
        const parsed = new URL(url)
        return originalFetch(`${emptyBase}${parsed.pathname}${parsed.search}`, init)
      }
      return originalFetch(input, init)
    }) as typeof fetch

    const adapter = createListenBrainzAdapter({ username: 'testuser', token: 'testtoken' })
    const result = await adapter.fetch({ feedType: 'fresh-releases' })
    expect(result.artists).toHaveLength(0)

    global.fetch = savedFetch
    emptyServer.close()
  })

  it('returns empty when no Weekly Jams playlist found', async () => {
    const noJamsServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          playlists: [
            {
              playlist: {
                title: 'Some Other Playlist',
                track: [{ creator: 'Some Artist', title: 'Track' }],
              },
            },
          ],
        }),
      )
    })
    await new Promise<void>((r) => noJamsServer.listen(0, '127.0.0.1', r))
    const noJamsAddr = noJamsServer.address() as AddressInfo
    const noJamsBase = `http://127.0.0.1:${noJamsAddr.port}`

    const savedFetch = global.fetch
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('api.listenbrainz.org')) {
        const parsed = new URL(url)
        return originalFetch(`${noJamsBase}${parsed.pathname}${parsed.search}`, init)
      }
      return originalFetch(input, init)
    }) as typeof fetch

    const adapter = createListenBrainzAdapter({ username: 'testuser', token: 'testtoken' })
    const result = await adapter.fetch({ feedType: 'weekly-jams' })
    expect(result.artists).toHaveLength(0)

    global.fetch = savedFetch
    noJamsServer.close()
  })
})
