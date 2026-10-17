// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMusicBrainzClient,
  type MBArtist,
  type MBRelation,
  type MBSearchResult,
  parseYear,
} from '@/core/clients/musicbrainz'
import { coverageToReleaseCandidates } from '@/core/discovery-modes/modes/gap-fill'
import { createAlbumCoverageService } from '@/core/library/album-coverage'
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
  const MockPQueue = vi.fn().mockImplementation(function (this: { add: typeof mockAdd }) {
    this.add = mockAdd
  })
  ;(MockPQueue as unknown as { mockAdd: typeof mockAdd }).mockAdd = mockAdd
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
  aliases: [{ name: 'Radiohead alias' }],
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
    it('uses the configured mirror base and disables redirects', async () => {
      vi.stubEnv('DIGARR_MUSICBRAINZ_URL', 'http://mirror.example:5000/custom/ws/2/')
      vi.stubEnv('DIGARR_MUSICBRAINZ_INTERVAL_MS', '50')
      vi.resetModules()
      try {
        const { createMusicBrainzClient: createMirrorClient } = await import(
          '@/core/clients/musicbrainz'
        )
        mockFetch.mockResolvedValueOnce(makeJsonResponse({ artists: [] }))
        await createMirrorClient().searchArtist('AC/DC')
        expect(mockFetch).toHaveBeenCalledWith(
          'http://mirror.example:5000/custom/ws/2/artist/?query=AC%2FDC&fmt=json',
          expect.objectContaining({
            redirect: 'error',
            headers: { 'User-Agent': USER_AGENT },
            signal: expect.any(AbortSignal),
          }),
        )
        expect(PQueue).toHaveBeenCalledWith({ concurrency: 1, interval: 50, intervalCap: 1 })
      } finally {
        vi.unstubAllEnvs()
        vi.resetModules()
      }
    })

    it('creates a shared PQueue with concurrency:1, interval:1000, intervalCap:1', async () => {
      vi.resetModules()
      const { default: FreshPQueue } = await import('p-queue')
      await import('@/core/clients/musicbrainz')
      expect(FreshPQueue).toHaveBeenCalledWith({
        concurrency: 1,
        interval: 1000,
        intervalCap: 1,
      })
    })

    it('shares one queue across all clients instead of one per client', () => {
      // Queue is constructed once at module load; creating clients must not
      // construct new queues (else concurrent runs exceed MB's 1 req/s ceiling).
      createMusicBrainzClient()
      createMusicBrainzClient()
      expect(PQueue).not.toHaveBeenCalled()
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
    it('GETs /artist/{mbid}?inc=tags+url-rels+aliases&fmt=json', async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse(MOCK_ARTIST_RESPONSE))
      const client = createMusicBrainzClient()
      await client.lookupArtist(MOCK_ARTIST_MBID)

      const [url] = mockFetch.mock.calls[0] as [string]
      expect(url).toBe(
        `${MB_BASE}/artist/${MOCK_ARTIST_MBID}?inc=tags%2Burl-rels%2Baliases&fmt=json`,
      )
    })

    it('returns artist with name, disambiguation, tags, and relations', async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse(MOCK_ARTIST_RESPONSE))
      const client = createMusicBrainzClient()
      const result = await client.lookupArtist(MOCK_ARTIST_MBID)

      expect(result.id).toBe(MOCK_ARTIST_MBID)
      expect(result.name).toBe('Radiohead')
      expect(result.aliases).toEqual([{ name: 'Radiohead alias' }])
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

  describe('rate limiter - queue integration', () => {
    const sharedAdd = (PQueue as unknown as { mockAdd: ReturnType<typeof vi.fn> }).mockAdd

    it('routes lookupArtist through the shared queue', async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse(MOCK_ARTIST_RESPONSE))
      const client = createMusicBrainzClient()
      await client.lookupArtist(MOCK_ARTIST_MBID)
      expect(sharedAdd).toHaveBeenCalledOnce()
    })

    it('routes searchArtist through the shared queue', async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse(MOCK_SEARCH_RESPONSE))
      const client = createMusicBrainzClient()
      await client.searchArtist('Radiohead')
      expect(sharedAdd).toHaveBeenCalledOnce()
    })

    it('routes getReleaseGroups through the shared queue', async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ 'release-groups': [] }))
      const client = createMusicBrainzClient()
      await client.getReleaseGroups(MOCK_ARTIST_MBID)
      expect(sharedAdd).toHaveBeenCalledOnce()
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

    it('defaults the type filter to album|ep|single', async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ 'release-groups': [] }))
      const client = createMusicBrainzClient()
      await client.getReleaseGroups(MOCK_ARTIST_MBID)

      const [url] = mockFetch.mock.calls[0] as [string]
      expect(decodeURIComponent(new URL(url).searchParams.get('type') ?? '')).toBe(
        'album|ep|single',
      )
    })

    it('narrows the type filter to album when requested', async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ 'release-groups': [] }))
      const client = createMusicBrainzClient()
      await client.getReleaseGroups(MOCK_ARTIST_MBID, ['album'])

      const [url] = mockFetch.mock.calls[0] as [string]
      expect(new URL(url).searchParams.get('type')).toBe('album')
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

  describe('release-group pagination', () => {
    function groups(start: number, length: number) {
      return Array.from({ length }, (_, index) => ({
        id: `rg-${start + index}`,
        title: `Album ${start + index}`,
        'primary-type': 'Album',
        'first-release-date': '2001-02-03',
      }))
    }

    it('preserves secondary types across pages without narrowing the shared catalog', async () => {
      const firstPage = groups(0, 100).map((group) => ({ ...group, 'secondary-types': [] }))
      const laterPage = [
        { ...groups(100, 1)[0], 'secondary-types': ['Live'] },
        { ...groups(101, 1)[0], 'secondary-types': ['Compilation', 'Live'] },
        { ...groups(102, 1)[0], 'primary-type': 'EP', 'secondary-types': [] },
        ...groups(103, 1),
      ]
      for (const [offset, page] of [
        [0, firstPage],
        [100, laterPage],
      ] as const) {
        mockFetch.mockResolvedValueOnce(
          makeJsonResponse({
            'release-groups': page,
            'release-group-count': 104,
            'release-group-offset': offset,
          }),
        )
      }

      const result = await createMusicBrainzClient().getReleaseGroups(MOCK_ARTIST_MBID)

      expect(result).toHaveLength(104)
      expect(result[0]).toMatchObject({ secondaryTypes: [] })
      expect(result.slice(100)).toEqual([
        expect.objectContaining({ id: 'rg-100', type: 'Album', secondaryTypes: ['Live'] }),
        expect.objectContaining({
          id: 'rg-101',
          type: 'Album',
          secondaryTypes: ['Compilation', 'Live'],
        }),
        expect.objectContaining({ id: 'rg-102', type: 'EP', secondaryTypes: [] }),
        expect.objectContaining({ id: 'rg-103', type: 'Album' }),
      ])
      expect(result[103]?.secondaryTypes).toBeUndefined()
    })

    it.each([0, 99, 100, 101, 200, 10_000])(
      'retrieves all %i advertised groups through the shared request queue',
      async (count) => {
        const pages = Math.max(1, Math.ceil(count / 100))
        for (let page = 0; page < pages; page += 1) {
          mockFetch.mockResolvedValueOnce(
            makeJsonResponse({
              'release-groups': groups(page * 100, Math.min(100, count - page * 100)),
              'release-group-count': count,
              'release-group-offset': page * 100,
            }),
          )
        }

        const result = await createMusicBrainzClient().getReleaseGroups(MOCK_ARTIST_MBID, ['album'])
        expect(result.map((group) => group.id)).toEqual(groups(0, count).map((group) => group.id))
        expect(mockFetch).toHaveBeenCalledTimes(pages)
        const sharedAdd = (PQueue as unknown as { mockAdd: ReturnType<typeof vi.fn> }).mockAdd
        expect(sharedAdd).toHaveBeenCalledTimes(pages)
        for (const [index, [url, options]] of mockFetch.mock.calls.entries()) {
          expect(Object.fromEntries(new URL(url).searchParams)).toEqual({
            artist: MOCK_ARTIST_MBID,
            type: 'album',
            fmt: 'json',
            limit: '100',
            offset: String(index * 100),
          })
          expect(options.headers['User-Agent']).toBe(USER_AGENT)
        }
      },
    )

    it.each([
      {
        name: 'short final page',
        pages: [groups(0, 100), groups(100, 1)],
        offsets: [0, 100],
        count: 101,
      },
      { name: 'empty final page', pages: [groups(0, 100), []], offsets: [0, 100], count: 100 },
      {
        name: 'overlapping IDs with raw offsets',
        pages: [
          groups(0, 100),
          [{ ...groups(99, 1)[0], title: 'Changed title' }, ...groups(100, 1)],
        ],
        offsets: [0, 100],
        count: 101,
      },
      {
        name: 'duplicates within a full page',
        pages: [[...groups(0, 99), ...groups(98, 1)], groups(99, 1)],
        offsets: [0, 100],
        count: 100,
      },
    ])('collects metadata-free pages with $name', async ({ pages, offsets, count }) => {
      for (const page of pages) {
        mockFetch.mockResolvedValueOnce(makeJsonResponse({ 'release-groups': page }))
      }
      const result = await createMusicBrainzClient().getReleaseGroups(MOCK_ARTIST_MBID)
      expect(result).toEqual(
        groups(0, count).map((group) => ({
          id: group.id,
          title: group.title,
          type: 'Album',
          firstReleaseDate: '2001-02-03',
        })),
      )
      expect(
        mockFetch.mock.calls.map(([url]) => Number(new URL(url).searchParams.get('offset'))),
      ).toEqual(offsets)
      for (const [url] of mockFetch.mock.calls) {
        expect(new URL(url).searchParams.get('type')).toBe('album|ep|single')
      }
    })

    it.each([
      ...(['release-group-count', 'release-group-offset'] as const).flatMap((key) =>
        [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, '100', null].map((value) => ({
          name: `invalid ${key}: ${String(value)}`,
          pages: [{ 'release-groups': groups(0, 1), [key]: value }],
        })),
      ),
      {
        name: 'mismatched offset',
        pages: [{ 'release-groups': groups(0, 1), 'release-group-offset': 1 }],
      },
      { name: 'oversized page', pages: [{ 'release-groups': groups(0, 101) }] },
      ...[undefined, null, {}].map((value) => ({
        name: `malformed later release-groups: ${String(value)}`,
        pages: [{ 'release-groups': groups(0, 100) }, { 'release-groups': value }],
      })),
      {
        name: 'count smaller than page',
        pages: [{ 'release-groups': groups(0, 1), 'release-group-count': 0 }],
      },
      { name: 'empty first page with outstanding count', pages: [{ 'release-group-count': 1 }] },
      {
        name: 'premature empty page retaining the first count',
        pages: [{ 'release-groups': groups(0, 100), 'release-group-count': 101 }, {}],
      },
      {
        name: 'repeated full page',
        pages: [{ 'release-groups': groups(0, 100) }, { 'release-groups': groups(0, 100) }],
      },
      {
        name: 'short page with no new IDs',
        pages: [{ 'release-groups': groups(0, 100) }, { 'release-groups': groups(0, 1) }],
      },
      {
        name: 'changing count',
        pages: [
          { 'release-groups': groups(0, 100), 'release-group-count': 101 },
          { 'release-groups': groups(100, 1), 'release-group-count': 100 },
        ],
      },
      {
        name: 'later HTTP failure',
        pages: [{ 'release-groups': groups(0, 100) }, new Response('', { status: 404 })],
      },
      ...[undefined, 10_001].map((count) => ({
        name: `unproven completion at cap with count ${String(count)}`,
        pages: Array.from({ length: 100 }, (_, page) => ({
          'release-groups': groups(page * 100, 100),
          'release-group-count': count,
        })),
      })),
    ])('rejects incomplete results for $name', async ({ pages }) => {
      for (const page of pages) {
        mockFetch.mockResolvedValueOnce(page instanceof Response ? page : makeJsonResponse(page))
      }
      await expect(createMusicBrainzClient().getReleaseGroups(MOCK_ARTIST_MBID)).rejects.toThrow(
        /MusicBrainz/,
      )
      expect(mockFetch).toHaveBeenCalledTimes(pages.length)
    })

    it('retries a transient later page through the shared queue', async () => {
      vi.useFakeTimers()
      try {
        mockFetch.mockResolvedValueOnce(makeJsonResponse({ 'release-groups': groups(0, 100) }))
        mockFetch.mockResolvedValueOnce(
          new Response('', { status: 503, headers: { 'Retry-After': '1' } }),
        )
        mockFetch.mockResolvedValueOnce(makeJsonResponse({ 'release-groups': groups(100, 1) }))
        const pending = createMusicBrainzClient().getReleaseGroups(MOCK_ARTIST_MBID)
        await vi.runAllTimersAsync()
        expect(await pending).toHaveLength(101)
        expect(
          mockFetch.mock.calls.map(([url]) => new URL(url).searchParams.get('offset')),
        ).toEqual(['0', '100', '100'])
        const sharedAdd = (PQueue as unknown as { mockAdd: ReturnType<typeof vi.fn> }).mockAdd
        expect(sharedAdd).toHaveBeenCalledTimes(3)
      } finally {
        vi.useRealTimers()
      }
    })

    it('includes only the missing studio album after 100 owned studio albums in coverage and gap-fill', async () => {
      const firstPage = groups(0, 100).map((group) => ({ ...group, 'secondary-types': [] }))
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          'release-groups': firstPage,
          'release-group-count': 103,
          'release-group-offset': 0,
        }),
      )
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          'release-groups': [
            { ...groups(100, 1)[0], 'secondary-types': [] },
            { ...groups(101, 1)[0], 'secondary-types': ['Live'] },
            { ...groups(102, 1)[0], 'secondary-types': ['Compilation'] },
          ],
          'release-group-count': 103,
          'release-group-offset': 100,
        }),
      )
      const service = createAlbumCoverageService({
        mbClient: createMusicBrainzClient(),
        store: {
          listOwnedAlbumsForArtist: async () =>
            firstPage.map((group) => ({
              source: 'plex',
              sourceAlbumId: group.id,
              albumMbid: group.id,
              title: group.title,
              releaseYear: 2001,
              primaryType: 'Album',
            })),
        },
      })

      const coverage = await service.getCoverageForArtist(7, MOCK_ARTIST_MBID)
      expect(coverage).toMatchObject({ ownedCount: 100, totalCount: 101 })
      expect(coverageToReleaseCandidates(coverage, 'Artist')).toEqual([
        expect.objectContaining({
          candidateType: 'release',
          releaseGroupMbid: 'rg-100',
          artistMbid: MOCK_ARTIST_MBID,
          name: 'Album 100',
        }),
      ])
    })
  })

  describe('retry behavior on transient errors', () => {
    // Fake timers so the exponential backoff sleeps resolve instantly instead
    // of burning seconds of real wall clock per test.
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('retries on 503 and succeeds when upstream recovers', async () => {
      mockFetch.mockResolvedValueOnce(new Response('', { status: 503 }))
      mockFetch.mockResolvedValueOnce(new Response('', { status: 503 }))
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ artists: [] }))

      const client = createMusicBrainzClient()
      const promise = client.searchArtist('flaky-artist')
      await vi.runAllTimersAsync()
      const result = await promise

      expect(mockFetch).toHaveBeenCalledTimes(3)
      expect(result).toEqual({ artists: [] })
    })

    it('gives up after max retries and throws the final error', async () => {
      mockFetch.mockResolvedValue(new Response('', { status: 503 }))

      const client = createMusicBrainzClient()
      // Attach the rejection expectation before advancing timers so the
      // rejection is never unhandled.
      const assertion = expect(client.searchArtist('always-down')).rejects.toThrow(
        /MusicBrainz HTTP 503/,
      )
      await vi.runAllTimersAsync()
      await assertion
      // 1 initial + 3 retries = 4 total
      expect(mockFetch).toHaveBeenCalledTimes(4)
    })

    it('does not retry on non-transient 4xx', async () => {
      mockFetch.mockResolvedValueOnce(new Response('', { status: 400 }))

      const client = createMusicBrainzClient()
      await expect(client.searchArtist('bad-query')).rejects.toThrow(/MusicBrainz HTTP 400/)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('honors Retry-After header within the cap', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('', { status: 429, headers: { 'retry-after': '0' } }),
      )
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ artists: [] }))

      const client = createMusicBrainzClient()
      const promise = client.searchArtist('rate-limited')
      await vi.runAllTimersAsync()
      const result = await promise

      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(result).toEqual({ artists: [] })
    })
  })
})

describe('lookupRecording not-found detection', () => {
  const MBID_WITH_404 = '404aaaaa-0000-4000-8000-000000000404'

  it.each([
    { status: 404, result: null },
    { status: 400, result: 'throws' },
  ])('HTTP $status for an MBID containing 404', async ({ status, result }) => {
    mockFetch.mockResolvedValueOnce(new Response('', { status }))
    const client = createMusicBrainzClient()
    const call = client.lookupRecording(MBID_WITH_404)
    if (result === null) await expect(call).resolves.toBeNull()
    else await expect(call).rejects.toThrow(/HTTP 400/)
  })
})
