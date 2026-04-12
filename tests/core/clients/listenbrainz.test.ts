// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createListenBrainzClient } from '@/core/clients/listenbrainz'

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
const TEST_TOKEN = 'my-lb-token'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createListenBrainzClient', () => {
  describe('constructor / auth header', () => {
    it('creates an HTTP client with Authorization: Token header', () => {
      createListenBrainzClient(TEST_USERNAME, TEST_TOKEN)
      expect(createHttpClient).toHaveBeenCalledOnce()
      const config = vi.mocked(createHttpClient).mock.calls[0]?.[0]
      expect(config?.baseUrl).toBe('https://api.listenbrainz.org')
      expect(config?.headers?.Authorization).toBe(`Token ${TEST_TOKEN}`)
    })
  })

  describe('getTopArtists(range)', () => {
    it('GETs the correct endpoint for "week" range', async () => {
      mockGet.mockResolvedValueOnce({
        payload: {
          artists: [
            {
              artist_name: 'Radiohead',
              artist_mbid: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
              listen_count: 42,
            },
          ],
        },
      })
      const client = createListenBrainzClient(TEST_USERNAME, TEST_TOKEN)
      const result = await client.getTopArtists('week')
      expect(mockGet).toHaveBeenCalledWith(`/1/stats/user/${TEST_USERNAME}/artists?range=week`)
      expect(result).toEqual([
        {
          name: 'Radiohead',
          mbid: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
          playCount: 42,
          source: 'listenbrainz',
        },
      ])
    })

    it('handles all valid range values: month, year, all_time', async () => {
      for (const range of ['month', 'year', 'all_time'] as const) {
        mockGet.mockResolvedValueOnce({ payload: { artists: [] } })
        const client = createListenBrainzClient(TEST_USERNAME, TEST_TOKEN)
        await client.getTopArtists(range)
        expect(mockGet).toHaveBeenCalledWith(
          `/1/stats/user/${TEST_USERNAME}/artists?range=${range}`,
        )
        vi.clearAllMocks()
      }
    })

    it('maps LB response shape to { name, mbid, playCount, source }', async () => {
      mockGet.mockResolvedValueOnce({
        payload: {
          artists: [
            {
              artist_name: 'Portishead',
              artist_mbid: '8f6bd1e4-fbe1-4f50-aa9b-94c450ec0a11',
              listen_count: 100,
            },
            { artist_name: 'Massive Attack', artist_mbid: '', listen_count: 75 },
          ],
        },
      })
      const client = createListenBrainzClient(TEST_USERNAME, TEST_TOKEN)
      const result = await client.getTopArtists('month')
      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({
        name: 'Portishead',
        playCount: 100,
        source: 'listenbrainz',
      })
      expect(result[1]).toMatchObject({
        name: 'Massive Attack',
        playCount: 75,
        source: 'listenbrainz',
      })
    })
  })

  describe('getListenCount()', () => {
    it('GETs /1/user/{username}/listen-count and returns count', async () => {
      mockGet.mockResolvedValueOnce({ payload: { count: 12345 } })
      const client = createListenBrainzClient(TEST_USERNAME, TEST_TOKEN)
      const count = await client.getListenCount()
      expect(mockGet).toHaveBeenCalledWith(`/1/user/${TEST_USERNAME}/listen-count`)
      expect(count).toBe(12345)
    })

    it('returns a number', async () => {
      mockGet.mockResolvedValueOnce({ payload: { count: 0 } })
      const client = createListenBrainzClient(TEST_USERNAME, TEST_TOKEN)
      const count = await client.getListenCount()
      expect(typeof count).toBe('number')
    })
  })

  describe('getListeningActivity()', () => {
    it('GETs /1/stats/user/{username}/listening-activity?range=month', async () => {
      const mockActivity = [
        { listen_count: 50, from_ts: 1700000000, to_ts: 1702678400 },
        { listen_count: 80, from_ts: 1702678400, to_ts: 1705356800 },
      ]
      mockGet.mockResolvedValueOnce({
        payload: { listening_activity: mockActivity },
      })
      const client = createListenBrainzClient(TEST_USERNAME, TEST_TOKEN)
      const result = await client.getListeningActivity()
      expect(mockGet).toHaveBeenCalledWith(
        `/1/stats/user/${TEST_USERNAME}/listening-activity?range=month`,
      )
      expect(result).toEqual(mockActivity)
    })
  })

  describe('getSimilarArtists(mbid)', () => {
    it('GETs /1/lb-radio/artist/{mbid} and extracts unique similar artists', async () => {
      const mbid = 'a74b1b7f-71a5-4011-9441-d0b5e4122711'
      mockGet.mockResolvedValueOnce({
        'some-mbid': [
          {
            recording_mbid: 'rec-1',
            similar_artist_mbid: 'some-mbid',
            similar_artist_name: 'Thom Yorke',
            total_listen_count: 500,
          },
        ],
        'other-mbid': [
          {
            recording_mbid: 'rec-2',
            similar_artist_mbid: 'other-mbid',
            similar_artist_name: 'Portishead',
            total_listen_count: 300,
          },
        ],
      })
      const client = createListenBrainzClient(TEST_USERNAME, TEST_TOKEN)
      const result = await client.getSimilarArtists(mbid)
      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining(`/1/lb-radio/artist/${mbid}`))
      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({ name: 'Thom Yorke', score: 0.7 })
      expect(result[1]).toMatchObject({ name: 'Portishead', score: 0.7 })
    })

    it('filters out the seed artist from results', async () => {
      const mbid = 'seed-mbid'
      mockGet.mockResolvedValueOnce({
        'seed-mbid': [
          {
            recording_mbid: 'rec-self',
            similar_artist_mbid: 'seed-mbid',
            similar_artist_name: 'Seed Artist',
            total_listen_count: 1000,
          },
        ],
        'other-mbid': [
          {
            recording_mbid: 'rec-other',
            similar_artist_mbid: 'other-mbid',
            similar_artist_name: 'Other Artist',
            total_listen_count: 200,
          },
        ],
      })
      const client = createListenBrainzClient(TEST_USERNAME, TEST_TOKEN)
      const result = await client.getSimilarArtists(mbid)
      expect(result).toHaveLength(1)
      expect(result[0]?.name).toBe('Other Artist')
    })

    it('deduplicates artists appearing in multiple recording groups', async () => {
      const mbid = 'a74b1b7f-71a5-4011-9441-d0b5e4122711'
      mockGet.mockResolvedValueOnce({
        group1: [
          {
            recording_mbid: 'rec-1',
            similar_artist_mbid: 'dup-mbid',
            similar_artist_name: 'Dupe',
            total_listen_count: 100,
          },
        ],
        group2: [
          {
            recording_mbid: 'rec-2',
            similar_artist_mbid: 'dup-mbid',
            similar_artist_name: 'Dupe',
            total_listen_count: 200,
          },
        ],
      })
      const client = createListenBrainzClient(TEST_USERNAME, TEST_TOKEN)
      const result = await client.getSimilarArtists(mbid)
      expect(result).toHaveLength(1)
    })

    it('returns empty array when API returns empty response', async () => {
      const mbid = 'a74b1b7f-71a5-4011-9441-d0b5e4122711'
      mockGet.mockResolvedValueOnce({})
      const client = createListenBrainzClient(TEST_USERNAME, TEST_TOKEN)
      const result = await client.getSimilarArtists(mbid)
      expect(result).toEqual([])
    })
  })

  describe('getArtistRadio(mbid, mode)', () => {
    it('extracts unique artists from radio response', async () => {
      mockGet.mockResolvedValueOnce({
        '0': [
          {
            recording_mbid: 'rec-1',
            similar_artist_mbid: 'artist-1',
            similar_artist_name: 'Artist One',
            total_listen_count: 100,
          },
          {
            recording_mbid: 'rec-2',
            similar_artist_mbid: 'artist-1',
            similar_artist_name: 'Artist One',
            total_listen_count: 80,
          },
          {
            recording_mbid: 'rec-3',
            similar_artist_mbid: 'artist-2',
            similar_artist_name: 'Artist Two',
            total_listen_count: 50,
          },
        ],
      })

      const client = createListenBrainzClient(TEST_USERNAME, TEST_TOKEN)
      const result = await client.getArtistRadio('seed-mbid', 'medium')

      expect(result).toEqual([
        { name: 'Artist One', mbid: 'artist-1', score: expect.any(Number) },
        { name: 'Artist Two', mbid: 'artist-2', score: expect.any(Number) },
      ])
      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('/1/lb-radio/artist/seed-mbid'))
      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('mode=medium'))
    })

    it('defaults mode to medium', async () => {
      mockGet.mockResolvedValueOnce({})

      const client = createListenBrainzClient(TEST_USERNAME, TEST_TOKEN)
      await client.getArtistRadio('seed-mbid')

      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('mode=medium'))
    })

    it('filters out the seed MBID from results', async () => {
      mockGet.mockResolvedValueOnce({
        '0': [
          {
            recording_mbid: 'rec-seed',
            similar_artist_mbid: 'seed-mbid',
            similar_artist_name: 'Seed Artist',
            total_listen_count: 999,
          },
          {
            recording_mbid: 'rec-other',
            similar_artist_mbid: 'other-artist',
            similar_artist_name: 'Other Artist',
            total_listen_count: 50,
          },
        ],
      })

      const client = createListenBrainzClient(TEST_USERNAME, TEST_TOKEN)
      const result = await client.getArtistRadio('seed-mbid', 'medium')

      expect(result).toHaveLength(1)
      expect(result[0]?.mbid).toBe('other-artist')
    })

    it('deduplicates artists appearing across multiple groups', async () => {
      mockGet.mockResolvedValueOnce({
        '0': [
          {
            recording_mbid: 'rec-1',
            similar_artist_mbid: 'shared-artist',
            similar_artist_name: 'Shared Artist',
            total_listen_count: 100,
          },
        ],
        '1': [
          {
            recording_mbid: 'rec-2',
            similar_artist_mbid: 'shared-artist',
            similar_artist_name: 'Shared Artist',
            total_listen_count: 200,
          },
        ],
      })

      const client = createListenBrainzClient(TEST_USERNAME, TEST_TOKEN)
      const result = await client.getArtistRadio('seed-mbid', 'medium')

      expect(result).toHaveLength(1)
      expect(result[0]?.mbid).toBe('shared-artist')
    })

    it('returns empty array for empty response', async () => {
      mockGet.mockResolvedValueOnce({})

      const client = createListenBrainzClient(TEST_USERNAME, TEST_TOKEN)
      const result = await client.getArtistRadio('seed-mbid')

      expect(result).toEqual([])
    })
  })

  describe('getUserRadio(targetUsername, mode)', () => {
    it('fetches top artists then runs artist radio on the top one', async () => {
      // First call: getTopArtistsForUser
      mockGet.mockResolvedValueOnce({
        payload: {
          artists: [{ artist_name: 'Top Artist', artist_mbid: 'top-mbid', listen_count: 500 }],
        },
      })
      // Second call: getArtistRadio on top-mbid
      mockGet.mockResolvedValueOnce({
        '0': [
          {
            recording_mbid: 'rec-1',
            similar_artist_mbid: 'artist-1',
            similar_artist_name: 'Radio Result',
            total_listen_count: 200,
          },
        ],
      })

      const client = createListenBrainzClient(TEST_USERNAME, TEST_TOKEN)
      const result = await client.getUserRadio('targetuser', 'easy')

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({ name: 'Radio Result', mbid: 'artist-1' })
      // First call fetches top artists for targetuser
      expect(mockGet).toHaveBeenCalledWith('/1/stats/user/targetuser/artists?range=month')
      // Second call runs artist radio seeded from top artist
      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('/1/lb-radio/artist/top-mbid'))
    })

    it('returns empty when user has no artists with MBIDs', async () => {
      mockGet.mockResolvedValueOnce({
        payload: {
          artists: [{ artist_name: 'No MBID', artist_mbid: '', listen_count: 100 }],
        },
      })

      const client = createListenBrainzClient(TEST_USERNAME, TEST_TOKEN)
      const result = await client.getUserRadio('targetuser')

      expect(result).toEqual([])
    })
  })

  describe('getSimilarUsers()', () => {
    it('returns similar users ranked by similarity', async () => {
      mockGet.mockResolvedValueOnce({
        payload: [
          { user_name: 'alice', similarity: 0.85 },
          { user_name: 'bob', similarity: 0.72 },
        ],
      })

      const client = createListenBrainzClient(TEST_USERNAME, TEST_TOKEN)
      const result = await client.getSimilarUsers()

      expect(result).toEqual([
        { username: 'alice', similarity: 0.85 },
        { username: 'bob', similarity: 0.72 },
      ])
      expect(mockGet).toHaveBeenCalledWith(`/1/user/${TEST_USERNAME}/similar-users`)
    })

    it('returns empty array when no similar users found', async () => {
      mockGet.mockResolvedValueOnce({ payload: [] })

      const client = createListenBrainzClient(TEST_USERNAME, TEST_TOKEN)
      const result = await client.getSimilarUsers()

      expect(result).toEqual([])
    })
  })

  describe('getTopArtistsForUser(targetUsername, range)', () => {
    it('fetches top artists for an arbitrary user', async () => {
      mockGet.mockResolvedValueOnce({
        payload: {
          artists: [{ artist_name: 'Radiohead', artist_mbid: 'mbid-1', listen_count: 500 }],
        },
      })

      const client = createListenBrainzClient(TEST_USERNAME, TEST_TOKEN)
      const result = await client.getTopArtistsForUser('otheruser', 'month')

      expect(result).toEqual([
        { name: 'Radiohead', mbid: 'mbid-1', playCount: 500, source: 'listenbrainz' },
      ])
      expect(mockGet).toHaveBeenCalledWith('/1/stats/user/otheruser/artists?range=month')
    })
  })

  describe('testConnection()', () => {
    it('returns success:true when getListenCount() resolves', async () => {
      mockGet.mockResolvedValueOnce({ payload: { count: 999 } })
      const client = createListenBrainzClient(TEST_USERNAME, TEST_TOKEN)
      const result = await client.testConnection()
      expect(result.success).toBe(true)
      expect(typeof result.message).toBe('string')
    })

    it('includes listen count in details', async () => {
      mockGet.mockResolvedValueOnce({ payload: { count: 7654 } })
      const client = createListenBrainzClient(TEST_USERNAME, TEST_TOKEN)
      const result = await client.testConnection()
      expect(result.details).toMatchObject({ listenCount: 7654 })
    })

    it('returns success:false with error message when getListenCount() rejects', async () => {
      mockGet.mockRejectedValueOnce(new Error('network timeout'))
      const client = createListenBrainzClient(TEST_USERNAME, TEST_TOKEN)
      const result = await client.testConnection()
      expect(result.success).toBe(false)
      expect(result.message).toMatch(/network timeout/)
    })

    it('returns ServiceTestResult shape (success, message)', async () => {
      mockGet.mockResolvedValueOnce({ payload: { count: 1 } })
      const client = createListenBrainzClient(TEST_USERNAME, TEST_TOKEN)
      const result = await client.testConnection()
      expect(result).toHaveProperty('success')
      expect(result).toHaveProperty('message')
    })
  })
})
