// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createLastFmClient } from '@/core/clients/lastfm'

// Mock the HTTP client module so we never hit a real server.
const mockGet = vi.fn()

vi.mock('@/core/clients/http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/clients/http')>()
  return {
    ...actual,
    createHttpClient: vi.fn(() => ({
      get: mockGet,
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    })),
  }
})

const { createHttpClient } = await import('@/core/clients/http')

const TEST_USERNAME = 'testuser'
const TEST_API_KEY = 'deadbeef1234'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createLastFmClient', () => {
  describe('constructor', () => {
    it('creates an HTTP client with the Last.fm base URL', () => {
      createLastFmClient(TEST_USERNAME, TEST_API_KEY)
      expect(createHttpClient).toHaveBeenCalledOnce()
      const config = vi.mocked(createHttpClient).mock.calls[0]?.[0]
      expect(config?.baseUrl).toBe('https://ws.audioscrobbler.com/2.0/')
    })
  })

  describe('getSimilarArtists(artist)', () => {
    it('GETs artist.getSimilar with api_key in query params', async () => {
      mockGet.mockResolvedValueOnce({
        similarartists: {
          artist: [
            { name: 'Portishead', match: '0.82', mbid: 'some-mbid' },
            { name: 'Massive Attack', match: '0.75', mbid: '' },
          ],
        },
      })
      const client = createLastFmClient(TEST_USERNAME, TEST_API_KEY)
      const result = await client.getSimilarArtists('Radiohead')
      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('method=artist.getSimilar'))
      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining(`api_key=${TEST_API_KEY}`))
      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('artist=Radiohead'))
      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({
        name: 'Portishead',
        mbid: 'some-mbid',
        similarityScore: 0.82,
        source: 'lastfm',
      })
      expect(result[1]).toMatchObject({
        name: 'Massive Attack',
        similarityScore: 0.75,
        source: 'lastfm',
      })
    })

    it('returns DiscoveredArtist shape with parsed similarityScore', async () => {
      mockGet.mockResolvedValueOnce({
        similarartists: {
          artist: [{ name: 'Thom Yorke', match: '0.95', mbid: 'mbid-ty' }],
        },
      })
      const client = createLastFmClient(TEST_USERNAME, TEST_API_KEY)
      const result = await client.getSimilarArtists('Radiohead')
      expect(result[0]).toEqual({
        name: 'Thom Yorke',
        mbid: 'mbid-ty',
        similarityScore: 0.95,
        source: 'lastfm',
      })
    })

    it('accepts an optional mbid parameter', async () => {
      mockGet.mockResolvedValueOnce({ similarartists: { artist: [] } })
      const client = createLastFmClient(TEST_USERNAME, TEST_API_KEY)
      await client.getSimilarArtists('Radiohead', 'a74b1b7f-71a5-4011-9441-d0b5e4122711')
      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('mbid=a74b1b7f-71a5-4011-9441-d0b5e4122711'),
      )
    })

    it('returns empty array when no similar artists found', async () => {
      mockGet.mockResolvedValueOnce({ similarartists: { artist: [] } })
      const client = createLastFmClient(TEST_USERNAME, TEST_API_KEY)
      const result = await client.getSimilarArtists('UnknownBand')
      expect(result).toEqual([])
    })
  })

  describe('getTopArtists(period)', () => {
    it('GETs user.getTopArtists with correct period and api_key', async () => {
      mockGet.mockResolvedValueOnce({
        topartists: {
          artist: [
            { name: 'Radiohead', mbid: 'mbid-rh', playcount: '123' },
            { name: 'Portishead', mbid: '', playcount: '77' },
          ],
        },
      })
      const client = createLastFmClient(TEST_USERNAME, TEST_API_KEY)
      const result = await client.getTopArtists('7day')
      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('method=user.getTopArtists'))
      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining(`user=${TEST_USERNAME}`))
      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('period=7day'))
      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining(`api_key=${TEST_API_KEY}`))
      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({
        name: 'Radiohead',
        mbid: 'mbid-rh',
        playCount: 123,
        source: 'lastfm',
      })
    })

    it('parses playcount as integer', async () => {
      mockGet.mockResolvedValueOnce({
        topartists: {
          artist: [{ name: 'Boards of Canada', mbid: 'boc-mbid', playcount: '456' }],
        },
      })
      const client = createLastFmClient(TEST_USERNAME, TEST_API_KEY)
      const result = await client.getTopArtists('overall')
      expect(result[0]?.playCount).toBe(456)
      expect(typeof result[0]?.playCount).toBe('number')
    })

    it('handles all valid period values', async () => {
      const periods = ['7day', '1month', '3month', '6month', '12month', 'overall'] as const
      for (const period of periods) {
        mockGet.mockResolvedValueOnce({ topartists: { artist: [] } })
        const client = createLastFmClient(TEST_USERNAME, TEST_API_KEY)
        await client.getTopArtists(period)
        expect(mockGet).toHaveBeenCalledWith(expect.stringContaining(`period=${period}`))
        vi.clearAllMocks()
      }
    })
  })

  describe('getRecentTracks()', () => {
    it('GETs user.getRecentTracks with api_key and limit=50', async () => {
      mockGet.mockResolvedValueOnce({
        recenttracks: {
          track: [
            { artist: { '#text': 'Radiohead' }, name: 'Creep' },
            { artist: { '#text': 'Portishead' }, name: 'Sour Times' },
          ],
        },
      })
      const client = createLastFmClient(TEST_USERNAME, TEST_API_KEY)
      const result = await client.getRecentTracks()
      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('method=user.getRecentTracks'))
      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining(`user=${TEST_USERNAME}`))
      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining(`api_key=${TEST_API_KEY}`))
      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('limit=50'))
      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({ artist: { '#text': 'Radiohead' }, name: 'Creep' })
    })

    it('returns raw track array', async () => {
      mockGet.mockResolvedValueOnce({
        recenttracks: { track: [] },
      })
      const client = createLastFmClient(TEST_USERNAME, TEST_API_KEY)
      const result = await client.getRecentTracks()
      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('api_key appended to all requests', () => {
    it('includes api_key in getSimilarArtists URL', async () => {
      mockGet.mockResolvedValueOnce({ similarartists: { artist: [] } })
      const client = createLastFmClient(TEST_USERNAME, TEST_API_KEY)
      await client.getSimilarArtists('TestArtist')
      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining(`api_key=${TEST_API_KEY}`))
    })

    it('includes api_key in getTopArtists URL', async () => {
      mockGet.mockResolvedValueOnce({ topartists: { artist: [] } })
      const client = createLastFmClient(TEST_USERNAME, TEST_API_KEY)
      await client.getTopArtists('1month')
      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining(`api_key=${TEST_API_KEY}`))
    })

    it('includes api_key in getRecentTracks URL', async () => {
      mockGet.mockResolvedValueOnce({ recenttracks: { track: [] } })
      const client = createLastFmClient(TEST_USERNAME, TEST_API_KEY)
      await client.getRecentTracks()
      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining(`api_key=${TEST_API_KEY}`))
    })
  })

  describe('getTopArtistsByTag(tag, limit)', () => {
    it('fetches tag.gettopartists with correct params', async () => {
      mockGet.mockResolvedValueOnce({
        topartists: {
          artist: [
            { name: 'Portishead', mbid: 'mbid-pt', listeners: '1200000' },
            { name: 'Massive Attack', mbid: 'mbid-ma', listeners: '980000' },
          ],
        },
      })
      const client = createLastFmClient(TEST_USERNAME, TEST_API_KEY)
      const result = await client.getTopArtistsByTag('trip-hop')

      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('method=tag.gettopartists'))
      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('tag=trip-hop'))
      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining(`api_key=${TEST_API_KEY}`))
      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('format=json'))
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({ name: 'Portishead', mbid: 'mbid-pt', listeners: 1200000 })
    })

    it('uses default limit of 20', async () => {
      mockGet.mockResolvedValueOnce({ topartists: { artist: [] } })
      const client = createLastFmClient(TEST_USERNAME, TEST_API_KEY)
      await client.getTopArtistsByTag('electronic')

      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('limit=20'))
    })

    it('passes custom limit', async () => {
      mockGet.mockResolvedValueOnce({ topartists: { artist: [] } })
      const client = createLastFmClient(TEST_USERNAME, TEST_API_KEY)
      await client.getTopArtistsByTag('ambient', 10)

      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('limit=10'))
    })

    it('returns empty array when topartists is missing', async () => {
      mockGet.mockResolvedValueOnce({})
      const client = createLastFmClient(TEST_USERNAME, TEST_API_KEY)
      const result = await client.getTopArtistsByTag('unknowntag')
      expect(result).toEqual([])
    })

    it('converts listeners to number and omits empty mbid', async () => {
      mockGet.mockResolvedValueOnce({
        topartists: {
          artist: [{ name: 'Boards of Canada', mbid: '', listeners: '450000' }],
        },
      })
      const client = createLastFmClient(TEST_USERNAME, TEST_API_KEY)
      const result = await client.getTopArtistsByTag('idm')
      expect(result[0]).toEqual({ name: 'Boards of Canada', mbid: undefined, listeners: 450000 })
    })
  })

  describe('testConnection()', () => {
    it('returns success:true when getTopArtists resolves', async () => {
      mockGet.mockResolvedValueOnce({
        topartists: {
          artist: [{ name: 'Radiohead', mbid: 'mbid-rh', playcount: '10' }],
        },
      })
      const client = createLastFmClient(TEST_USERNAME, TEST_API_KEY)
      const result = await client.testConnection()
      expect(result.success).toBe(true)
      expect(typeof result.message).toBe('string')
    })

    it('includes artist count in details', async () => {
      mockGet.mockResolvedValueOnce({
        topartists: {
          artist: [
            { name: 'Radiohead', mbid: '', playcount: '10' },
            { name: 'Portishead', mbid: '', playcount: '5' },
          ],
        },
      })
      const client = createLastFmClient(TEST_USERNAME, TEST_API_KEY)
      const result = await client.testConnection()
      expect(result.details).toMatchObject({ artistCount: 2 })
    })

    it('returns success:false with error message when getTopArtists rejects', async () => {
      mockGet.mockRejectedValueOnce(new Error('API key invalid'))
      const client = createLastFmClient(TEST_USERNAME, TEST_API_KEY)
      const result = await client.testConnection()
      expect(result.success).toBe(false)
      expect(result.message).toMatch(/API key invalid/)
    })

    it('returns ServiceTestResult shape (success, message)', async () => {
      mockGet.mockResolvedValueOnce({ topartists: { artist: [] } })
      const client = createLastFmClient(TEST_USERNAME, TEST_API_KEY)
      const result = await client.testConnection()
      expect(result).toHaveProperty('success')
      expect(result).toHaveProperty('message')
    })
  })

  describe('getTopAlbumsForArtist(artist, mbid, limit)', () => {
    it('GETs artist.getTopAlbums with api_key and maps playcount to popularity', async () => {
      mockGet.mockResolvedValueOnce({
        topalbums: {
          album: [
            { name: 'OK Computer', playcount: 12345, mbid: 'okc-mbid' },
            { name: 'Kid A', playcount: 9876, mbid: '' },
          ],
        },
      })
      const client = createLastFmClient(TEST_USERNAME, TEST_API_KEY)
      const result = await client.getTopAlbumsForArtist('Radiohead')

      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('method=artist.getTopAlbums'))
      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('artist=Radiohead'))
      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining(`api_key=${TEST_API_KEY}`))
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({ title: 'OK Computer', popularity: 12345, mbid: 'okc-mbid' })
      expect(result[1]).toEqual({ title: 'Kid A', popularity: 9876, mbid: undefined })
    })

    it('passes mbid when provided (prefers it over name)', async () => {
      mockGet.mockResolvedValueOnce({ topalbums: { album: [] } })
      const client = createLastFmClient(TEST_USERNAME, TEST_API_KEY)
      await client.getTopAlbumsForArtist('Radiohead', 'a74b1b7f-71a5-4011-9441-d0b5e4122711')
      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('mbid=a74b1b7f-71a5-4011-9441-d0b5e4122711'),
      )
    })

    it('uses a default limit and accepts a custom one', async () => {
      mockGet.mockResolvedValueOnce({ topalbums: { album: [] } })
      const client = createLastFmClient(TEST_USERNAME, TEST_API_KEY)
      await client.getTopAlbumsForArtist('Radiohead', undefined, 10)
      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('limit=10'))
    })

    it('parses string playcounts and tolerates missing values', async () => {
      mockGet.mockResolvedValueOnce({
        topalbums: {
          album: [{ name: 'Amnesiac', playcount: '4567', mbid: 'amn-mbid' }, { name: 'The Bends' }],
        },
      })
      const client = createLastFmClient(TEST_USERNAME, TEST_API_KEY)
      const result = await client.getTopAlbumsForArtist('Radiohead')
      expect(result[0]).toEqual({ title: 'Amnesiac', popularity: 4567, mbid: 'amn-mbid' })
      expect(result[1]).toEqual({ title: 'The Bends', popularity: 0, mbid: undefined })
    })

    it('returns empty array when topalbums is missing', async () => {
      mockGet.mockResolvedValueOnce({})
      const client = createLastFmClient(TEST_USERNAME, TEST_API_KEY)
      const result = await client.getTopAlbumsForArtist('UnknownBand')
      expect(result).toEqual([])
    })
  })
})
