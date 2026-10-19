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

const NEW_JAMS = '80d61d95-61b0-4a22-8556-443c0fb26078'
const OLD_JAMS = '11111111-2222-4333-8444-555555555555'
const EXPLORATION = 'c99f9e8d-77ab-446e-bf95-248bbc0ab535'

const jspfTrack = (creator: string, title: string, artistMbid: string, recordingMbid: string) => ({
  creator,
  title,
  identifier: [`https://musicbrainz.org/recording/${recordingMbid}`],
  extension: {
    'https://musicbrainz.org/doc/jspf#track': {
      additional_metadata: {
        artists: [{ artist_credit_name: creator, artist_mbid: artistMbid, join_phrase: '' }],
      },
      artist_identifiers: [`https://musicbrainz.org/artist/${artistMbid}`],
    },
  },
})

const createdForEntry = (mbid: string, title: string, date: string) => ({
  playlist: {
    title,
    date,
    identifier: `https://listenbrainz.org/playlist/${mbid}`,
    track: [], // the list endpoints never include tracks
  },
})

// Oldest first on purpose: the newest Weekly Jams must win by date, not list order.
const createdForFixture = {
  playlist_count: 3,
  playlists: [
    createdForEntry(
      OLD_JAMS,
      'Weekly Jams for testuser, week of 2026-09-28 Mon',
      '2026-09-28T05:00:00+00:00',
    ),
    createdForEntry(
      EXPLORATION,
      'Weekly Exploration for testuser, week of 2026-10-05 Mon',
      '2026-10-05T05:49:10+00:00',
    ),
    createdForEntry(
      NEW_JAMS,
      'Weekly Jams for testuser, week of 2026-10-05 Mon',
      '2026-10-05T05:43:41+00:00',
    ),
  ],
}

const playlistFixtures: Record<string, unknown> = {
  [NEW_JAMS]: {
    playlist: {
      title: 'Weekly Jams for testuser, week of 2026-10-05 Mon',
      track: [
        jspfTrack(
          'Jam Artist X',
          'Track 1',
          'aaaaaaaa-0000-4000-8000-000000000001',
          'bbbbbbbb-0000-4000-8000-000000000001',
        ),
        jspfTrack(
          'Jam Artist Y',
          'Track 2',
          'aaaaaaaa-0000-4000-8000-000000000002',
          'bbbbbbbb-0000-4000-8000-000000000002',
        ),
        jspfTrack(
          'jam artist x',
          'Track 3',
          'aaaaaaaa-0000-4000-8000-000000000001',
          'bbbbbbbb-0000-4000-8000-000000000003',
        ),
        { creator: 'Name Only', title: 'Track 4' },
        { title: 'Track 5' }, // missing creator
      ],
    },
  },
  [OLD_JAMS]: {
    playlist: {
      title: 'old',
      track: [
        jspfTrack(
          'Stale Artist',
          'Old',
          'aaaaaaaa-0000-4000-8000-000000000009',
          'bbbbbbbb-0000-4000-8000-000000000009',
        ),
      ],
    },
  },
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

    if (url.includes('/playlists/createdfor')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(createdForFixture))
      return
    }

    const playlistId = /\/playlist\/([0-9a-f-]+)/.exec(url)?.[1]
    if (playlistId && playlistFixtures[playlistId]) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(playlistFixtures[playlistId]))
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

  describe('fresh-releases', () => {
    it('fetches artists and deduplicates by lowercase name', async () => {
      const adapter = createListenBrainzAdapter({ username: 'testuser', token: 'testtoken' })
      const result = await adapter.fetch({ feedType: 'fresh-releases' })

      // One, Two, Three - duplicate of One filtered, missing artist skipped
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
    it('fetches tracks of the newest Weekly Jams from created-for playlists', async () => {
      const adapter = createListenBrainzAdapter({ username: 'testuser', token: 'testtoken' })
      const result = await adapter.fetch({ feedType: 'weekly-jams' })

      // newest playlist wins over list order and Weekly Exploration is ignored;
      // the duplicate artist and the track without a creator are dropped
      expect(result.artists.map((a) => a.name)).toEqual([
        'Jam Artist X',
        'Jam Artist Y',
        'Name Only',
      ])
      expect(result.artists[0]).toMatchObject({
        mbid: 'aaaaaaaa-0000-4000-8000-000000000001',
        source: 'listenbrainz:weekly-jams',
        similarityScore: 0.6,
      })
      expect(result.artists[2]?.mbid).toBeUndefined()
    })

    it('carries the recording MBID and title only when the artist MBID is known', async () => {
      const adapter = createListenBrainzAdapter({ username: 'testuser', token: 'testtoken' })
      const result = await adapter.fetch({ feedType: 'weekly-jams' })

      expect(result.artists[0]).toMatchObject({
        recordingMbid: 'bbbbbbbb-0000-4000-8000-000000000001',
        recordingTitle: 'Track 1',
      })
      expect(result.artists[2]?.recordingMbid).toBeUndefined()
    })

    it('returns empty with a message when no Weekly Jams playlist exists', async () => {
      const noJamsServer = http.createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            playlists: [
              createdForEntry(
                EXPLORATION,
                'Weekly Exploration for testuser',
                '2026-10-05T05:49:10+00:00',
              ),
            ],
          }),
        )
      })
      await new Promise<void>((r) => noJamsServer.listen(0, '127.0.0.1', r))
      const noJamsBase = `http://127.0.0.1:${(noJamsServer.address() as AddressInfo).port}`

      const savedFetch = global.fetch
      global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.includes('api.listenbrainz.org')) {
          const parsed = new URL(url)
          return originalFetch(`${noJamsBase}${parsed.pathname}${parsed.search}`, init)
        }
        return originalFetch(input, init)
      }) as typeof fetch

      try {
        const adapter = createListenBrainzAdapter({ username: 'testuser', token: 'testtoken' })
        const result = await adapter.fetch({ feedType: 'weekly-jams' })
        expect(result.artists).toHaveLength(0)
        expect(result.message).toMatch(/Weekly Jams/)
      } finally {
        global.fetch = savedFetch
        noJamsServer.close()
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

  it('applies the per-run limit option', async () => {
    const adapter = createListenBrainzAdapter({ username: 'testuser', token: 'testtoken' })
    const result = await adapter.fetch({ feedType: 'fresh-releases' }, { limit: 2 })
    expect(result.artists.map((a) => a.name)).toEqual(['Artist One', 'Artist Two'])
  })
})
