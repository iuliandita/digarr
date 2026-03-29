// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMusicBrainzClient,
  type MBArtist,
  type MBRelation,
  type MBSearchResult,
  parseYear,
} from '@/core/clients/musicbrainz'
import { VERSION } from '@/version'

// ---------------------------------------------------------------------------
// Mock fetch globally so nothing ever hits a real server.
// ---------------------------------------------------------------------------
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Mock p-queue so the rate-limiter queue is transparent in most tests.
// The queue factory is replaced with an implementation that just calls the
// function immediately (no queuing/delay).
vi.mock('p-queue', () => {
  const mockAdd = vi.fn((fn: () => unknown) => fn())
  class PQueue {
    add = mockAdd
    static _mockAdd = mockAdd
  }
  const MockPQueue = vi.fn().mockImplementation(function (this: PQueue) {
    this.add = mockAdd
  })
  return { default: MockPQueue }
})

const { default: PQueue } = await import('p-queue')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const MB_BASE = 'https://musicbrainz.org/ws/2'
const USER_AGENT = `Digarr/${VERSION} (https://github.com/iuliandita/digarr)`

const MOCK_ARTIST_MBID = 'a74b1b7f-71a5-4011-9441-d0b5e4122711'

const MOCK_ARTIST_RESPONSE: MBArtist = {
  id: MOCK_ARTIST_MBID,
  name: 'Radiohead',
  disambiguation: 'UK rock band',
  tags: [
    { name: 'alternative rock', count: 10 },
    { name: 'art rock', count: 7 },
  ],
  relations: [
    {
      type: 'streaming music',
      url: { resource: 'https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb' },
    },
    {
      type: 'free streaming',
      url: { resource: 'https://www.youtube.com/channel/UCq19-LqvG35A-30oyAiPiqA' },
    },
    {
      type: 'streaming music',
      url: { resource: 'https://music.apple.com/gb/artist/radiohead/657515' },
    },
    { type: 'streaming music', url: { resource: 'https://www.deezer.com/en/artist/394' } },
    { type: 'streaming music', url: { resource: 'https://tidal.com/browse/artist/13858' } },
    { type: 'blog', url: { resource: 'https://radiohead.com' } },
  ],
}

const MOCK_SEARCH_RESPONSE: MBSearchResult = {
  artists: [
    {
      id: MOCK_ARTIST_MBID,
      name: 'Radiohead',
      disambiguation: 'UK rock band',
      score: 100,
      tags: [{ name: 'rock', count: 5 }],
    },
    { id: 'other-mbid', name: 'Radio Head', disambiguation: 'other artist', score: 72, tags: [] },
  ],
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
})

describe('parseYear', () => {
  it('parses full date string', () => {
    expect(parseYear('1985-03-15')).toBe(1985)
  })
  it('parses year-month string', () => {
    expect(parseYear('1985-03')).toBe(1985)
  })
  it('parses year-only string', () => {
    expect(parseYear('1985')).toBe(1985)
  })
  it('returns undefined for empty string', () => {
    expect(parseYear('')).toBeUndefined()
  })
  it('returns undefined for undefined', () => {
    expect(parseYear(undefined)).toBeUndefined()
  })
  it('returns undefined for garbage input', () => {
    expect(parseYear('not-a-date')).toBeUndefined()
  })
})

describe('createMusicBrainzClient', () => {
  describe('p-queue rate limiter configuration', () => {
    it('creates PQueue with concurrency:1, interval:1000, intervalCap:1', () => {
      createMusicBrainzClient()
      expect(PQueue).toHaveBeenCalledWith({
        concurrency: 1,
        interval: 1000,
        intervalCap: 1,
      })
    })
  })

  describe('User-Agent header', () => {
    it('contains the current package.json version', () => {
      expect(USER_AGENT).toMatch(/^Digarr\/\d+\.\d+\.\d+/)
      expect(USER_AGENT).toContain(VERSION)
    })

    it('sends the correct User-Agent on lookupArtist', async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse(MOCK_ARTIST_RESPONSE))
      const client = createMusicBrainzClient()
      await client.lookupArtist(MOCK_ARTIST_MBID)

      expect(mockFetch).toHaveBeenCalledOnce()
      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit]
      expect((options.headers as Record<string, string>)['User-Agent']).toBe(USER_AGENT)
    })

    it('sends the correct User-Agent on searchArtist', async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse(MOCK_SEARCH_RESPONSE))
      const client = createMusicBrainzClient()
      await client.searchArtist('Radiohead')

      expect(mockFetch).toHaveBeenCalledOnce()
      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit]
      expect((options.headers as Record<string, string>)['User-Agent']).toBe(USER_AGENT)
    })
  })

  describe('lookupArtist(mbid)', () => {
    it('GETs /artist/{mbid}?inc=tags+url-rels&fmt=json', async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse(MOCK_ARTIST_RESPONSE))
      const client = createMusicBrainzClient()
      await client.lookupArtist(MOCK_ARTIST_MBID)

      const [url] = mockFetch.mock.calls[0] as [string]
      expect(url).toBe(`${MB_BASE}/artist/${MOCK_ARTIST_MBID}?inc=tags%2Burl-rels&fmt=json`)
    })

    it('returns artist with name, disambiguation, tags, and relations', async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse(MOCK_ARTIST_RESPONSE))
      const client = createMusicBrainzClient()
      const result = await client.lookupArtist(MOCK_ARTIST_MBID)

      expect(result.id).toBe(MOCK_ARTIST_MBID)
      expect(result.name).toBe('Radiohead')
      expect(result.disambiguation).toBe('UK rock band')
      expect(result.tags).toHaveLength(2)
      expect(result.tags?.[0]).toEqual({ name: 'alternative rock', count: 10 })
      expect(Array.isArray(result.relations)).toBe(true)
    })

    it('returns MBArtist shape with relations array', async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse(MOCK_ARTIST_RESPONSE))
      const client = createMusicBrainzClient()
      const result = await client.lookupArtist(MOCK_ARTIST_MBID)

      expect(result.relations).toHaveLength(6)
      expect(result.relations?.[0]).toMatchObject({
        type: 'streaming music',
        url: { resource: expect.stringContaining('spotify.com') },
      })
    })

    it('handles artist with no tags or relations', async () => {
      const minimal: MBArtist = { id: 'some-id', name: 'Minimal Band' }
      mockFetch.mockResolvedValueOnce(makeJsonResponse(minimal))
      const client = createMusicBrainzClient()
      const result = await client.lookupArtist('some-id')

      expect(result.name).toBe('Minimal Band')
      expect(result.tags).toBeUndefined()
      expect(result.relations).toBeUndefined()
    })
  })

  describe('searchArtist(query)', () => {
    it('GETs /artist/?query={encoded}&fmt=json', async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse(MOCK_SEARCH_RESPONSE))
      const client = createMusicBrainzClient()
      await client.searchArtist('Radiohead')

      const [url] = mockFetch.mock.calls[0] as [string]
      expect(url).toContain(`${MB_BASE}/artist/`)
      expect(url).toContain('query=Radiohead')
      expect(url).toContain('fmt=json')
    })

    it('returns candidates with MBIDs, names, scores', async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse(MOCK_SEARCH_RESPONSE))
      const client = createMusicBrainzClient()
      const result = await client.searchArtist('Radiohead')

      expect(result.artists).toHaveLength(2)
      expect(result.artists[0]).toMatchObject({
        id: MOCK_ARTIST_MBID,
        name: 'Radiohead',
        score: 100,
      })
      expect(result.artists[1]).toMatchObject({
        id: 'other-mbid',
        name: 'Radio Head',
        score: 72,
      })
    })

    it('URL-encodes special characters in query', async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ artists: [] }))
      const client = createMusicBrainzClient()
      await client.searchArtist('AC/DC')

      const [url] = mockFetch.mock.calls[0] as [string]
      // The slash should be encoded
      expect(url).not.toContain('query=AC/DC')
      expect(url).toContain('query=AC')
    })

    it('returns empty artists array when no results', async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ artists: [] }))
      const client = createMusicBrainzClient()
      const result = await client.searchArtist('xyzzy-no-match')

      expect(result.artists).toEqual([])
    })
  })

  describe('extractStreamingUrls(relations)', () => {
    it('extracts spotify URL from url-rels', () => {
      const client = createMusicBrainzClient()
      const relations: MBRelation[] = [
        {
          type: 'streaming music',
          url: { resource: 'https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb' },
        },
      ]
      const urls = client.extractStreamingUrls(relations)
      expect(urls.spotify).toBe('https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb')
    })

    it('extracts youtube URL from url-rels', () => {
      const client = createMusicBrainzClient()
      const relations: MBRelation[] = [
        {
          type: 'free streaming',
          url: { resource: 'https://www.youtube.com/channel/UCq19-LqvG35A-30oyAiPiqA' },
        },
      ]
      const urls = client.extractStreamingUrls(relations)
      expect(urls.youtube).toBe('https://www.youtube.com/channel/UCq19-LqvG35A-30oyAiPiqA')
    })

    it('extracts apple music URL', () => {
      const client = createMusicBrainzClient()
      const relations: MBRelation[] = [
        {
          type: 'streaming music',
          url: { resource: 'https://music.apple.com/gb/artist/radiohead/657515' },
        },
      ]
      const urls = client.extractStreamingUrls(relations)
      expect(urls.appleMusic).toBe('https://music.apple.com/gb/artist/radiohead/657515')
    })

    it('extracts deezer URL', () => {
      const client = createMusicBrainzClient()
      const relations: MBRelation[] = [
        { type: 'streaming music', url: { resource: 'https://www.deezer.com/en/artist/394' } },
      ]
      const urls = client.extractStreamingUrls(relations)
      expect(urls.deezer).toBe('https://www.deezer.com/en/artist/394')
    })

    it('extracts tidal URL', () => {
      const client = createMusicBrainzClient()
      const relations: MBRelation[] = [
        { type: 'streaming music', url: { resource: 'https://tidal.com/browse/artist/13858' } },
      ]
      const urls = client.extractStreamingUrls(relations)
      expect(urls.tidal).toBe('https://tidal.com/browse/artist/13858')
    })

    it('extracts soundcloud URL', () => {
      const client = createMusicBrainzClient()
      const relations: MBRelation[] = [
        { type: 'free streaming', url: { resource: 'https://soundcloud.com/radiohead' } },
      ]
      const urls = client.extractStreamingUrls(relations)
      expect(urls.soundcloud).toBe('https://soundcloud.com/radiohead')
    })

    it('extracts bandcamp URL', () => {
      const client = createMusicBrainzClient()
      const relations: MBRelation[] = [
        { type: 'free streaming', url: { resource: 'https://radiohead.bandcamp.com' } },
      ]
      const urls = client.extractStreamingUrls(relations)
      expect(urls.bandcamp).toBe('https://radiohead.bandcamp.com')
    })

    it('extracts music.youtube.com URL into youtube key', () => {
      const client = createMusicBrainzClient()
      const relations: MBRelation[] = [
        { type: 'streaming music', url: { resource: 'https://music.youtube.com/channel/UC123' } },
      ]
      const urls = client.extractStreamingUrls(relations)
      expect(urls.youtube).toBe('https://music.youtube.com/channel/UC123')
    })

    it('ignores non-streaming relations', () => {
      const client = createMusicBrainzClient()
      const relations: MBRelation[] = [
        { type: 'blog', url: { resource: 'https://radiohead.com' } },
        { type: 'official homepage', url: { resource: 'https://radiohead.com' } },
      ]
      const urls = client.extractStreamingUrls(relations)
      expect(Object.keys(urls)).toHaveLength(0)
    })

    it('returns empty object for empty relations array', () => {
      const client = createMusicBrainzClient()
      const urls = client.extractStreamingUrls([])
      expect(urls).toEqual({})
    })

    it('extracts multiple streaming platforms from full relations list', () => {
      const client = createMusicBrainzClient()
      const urls = client.extractStreamingUrls(MOCK_ARTIST_RESPONSE.relations ?? [])
      expect(urls.spotify).toContain('spotify.com')
      expect(urls.youtube).toContain('youtube.com')
      expect(urls.appleMusic).toContain('apple.com')
      expect(urls.deezer).toContain('deezer.com')
      expect(urls.tidal).toContain('tidal.com')
    })
  })

  describe('rate limiter -- queue integration', () => {
    it('routes lookupArtist through the p-queue', async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse(MOCK_ARTIST_RESPONSE))
      const client = createMusicBrainzClient()
      const instance = vi.mocked(PQueue).mock.results[0]?.value as { add: ReturnType<typeof vi.fn> }
      await client.lookupArtist(MOCK_ARTIST_MBID)
      expect(instance.add).toHaveBeenCalledOnce()
    })

    it('routes searchArtist through the p-queue', async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse(MOCK_SEARCH_RESPONSE))
      const client = createMusicBrainzClient()
      const instance = vi.mocked(PQueue).mock.results[0]?.value as { add: ReturnType<typeof vi.fn> }
      await client.searchArtist('Radiohead')
      expect(instance.add).toHaveBeenCalledOnce()
    })

    it('routes getReleaseGroups through the p-queue', async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ 'release-groups': [] }))
      const client = createMusicBrainzClient()
      const instance = vi.mocked(PQueue).mock.results[0]?.value as { add: ReturnType<typeof vi.fn> }
      await client.getReleaseGroups(MOCK_ARTIST_MBID)
      expect(instance.add).toHaveBeenCalledOnce()
    })
  })

  describe('getReleaseGroups(artistMbid)', () => {
    const MOCK_RG_RESPONSE = {
      'release-groups': [
        {
          id: 'rg-1',
          title: 'OK Computer',
          'primary-type': 'Album',
          'first-release-date': '1997-05-21',
        },
        {
          id: 'rg-2',
          title: 'Kid A',
          'primary-type': 'Album',
          'first-release-date': '2000-10-02',
        },
        {
          id: 'rg-3',
          title: 'Creep',
          'primary-type': 'Single',
          'first-release-date': '1992-09-21',
        },
        {
          id: 'rg-4',
          title: 'My Iron Lung EP',
          'primary-type': 'EP',
          'first-release-date': '1994-10-03',
        },
        {
          id: 'rg-5',
          title: 'No Primary Type Release',
          'first-release-date': '2020-01-01',
        },
        {
          id: 'rg-6',
          title: 'No Date Single',
          'primary-type': 'Single',
        },
      ],
    }

    it('GETs /release-group with artist, type, fmt, and limit params', async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ 'release-groups': [] }))
      const client = createMusicBrainzClient()
      await client.getReleaseGroups(MOCK_ARTIST_MBID)

      const [url] = mockFetch.mock.calls[0] as [string]
      expect(url).toContain(`${MB_BASE}/release-group`)
      expect(url).toContain(`artist=${MOCK_ARTIST_MBID}`)
      expect(url).toContain('fmt=json')
      expect(url).toContain('limit=100')
    })

    it('includes type filter in the query string', async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ 'release-groups': [] }))
      const client = createMusicBrainzClient()
      await client.getReleaseGroups(MOCK_ARTIST_MBID)

      const [url] = mockFetch.mock.calls[0] as [string]
      expect(url).toContain('type=')
    })

    it('returns correctly shaped MBReleaseGroup array', async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse(MOCK_RG_RESPONSE))
      const client = createMusicBrainzClient()
      const result = await client.getReleaseGroups(MOCK_ARTIST_MBID)

      expect(result).toHaveLength(6)
      expect(result[0]).toMatchObject({
        id: 'rg-1',
        title: 'OK Computer',
        type: 'Album',
        firstReleaseDate: '1997-05-21',
      })
    })

    it('maps missing primary-type to "Other"', async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse(MOCK_RG_RESPONSE))
      const client = createMusicBrainzClient()
      const result = await client.getReleaseGroups(MOCK_ARTIST_MBID)

      const noType = result.find((rg) => rg.id === 'rg-5')
      expect(noType?.type).toBe('Other')
    })

    it('maps missing first-release-date to undefined', async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse(MOCK_RG_RESPONSE))
      const client = createMusicBrainzClient()
      const result = await client.getReleaseGroups(MOCK_ARTIST_MBID)

      const noDate = result.find((rg) => rg.id === 'rg-6')
      expect(noDate?.firstReleaseDate).toBeUndefined()
    })

    it('returns empty array when release-groups is missing from response', async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({}))
      const client = createMusicBrainzClient()
      const result = await client.getReleaseGroups(MOCK_ARTIST_MBID)
      expect(result).toEqual([])
    })

    it('returns empty array when release-groups is empty', async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ 'release-groups': [] }))
      const client = createMusicBrainzClient()
      const result = await client.getReleaseGroups(MOCK_ARTIST_MBID)
      expect(result).toEqual([])
    })

    it('throws on non-ok HTTP response', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } }),
      )
      const client = createMusicBrainzClient()
      await expect(client.getReleaseGroups(MOCK_ARTIST_MBID)).rejects.toThrow(/404/)
    })

    it('sends User-Agent header', async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ 'release-groups': [] }))
      const client = createMusicBrainzClient()
      await client.getReleaseGroups(MOCK_ARTIST_MBID)

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit]
      expect((options.headers as Record<string, string>)['User-Agent']).toBe(USER_AGENT)
    })

    it('maps all standard release types correctly', async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse(MOCK_RG_RESPONSE))
      const client = createMusicBrainzClient()
      const result = await client.getReleaseGroups(MOCK_ARTIST_MBID)

      const types = result.map((rg) => rg.type)
      expect(types).toContain('Album')
      expect(types).toContain('Single')
      expect(types).toContain('EP')
    })
  })
})
