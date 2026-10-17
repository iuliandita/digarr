// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDeezerUserClient } from '@/core/clients/deezer-user'

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

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createDeezerUserClient', () => {
  const requests = [
    [
      'getFavoriteArtists',
      (client: ReturnType<typeof createDeezerUserClient>) => client.getFavoriteArtists(),
    ],
    [
      'getFollowedArtists',
      (client: ReturnType<typeof createDeezerUserClient>) => client.getFollowedArtists(),
    ],
    [
      'getFlowRecommendations',
      (client: ReturnType<typeof createDeezerUserClient>) => client.getFlowRecommendations(),
    ],
    ['getPlaylists', (client: ReturnType<typeof createDeezerUserClient>) => client.getPlaylists()],
    [
      'getPlaylistTracks',
      (client: ReturnType<typeof createDeezerUserClient>) => client.getPlaylistTracks(42),
    ],
    ['getMe', (client: ReturnType<typeof createDeezerUserClient>) => client.getMe()],
  ] as const

  it.each(requests)('%s rejects provider error envelopes', async (_name, request) => {
    mockGet.mockResolvedValueOnce({
      error: { message: 'Untrusted provider text containing test-token' },
      data: [],
    })

    await expect(request(createDeezerUserClient('test-token'))).rejects.toThrow(
      'Deezer request failed. Reconnect Deezer or check its configuration in Settings.',
    )
  })

  it.each(requests)(
    '%s sanitizes transport failures without retaining the original error',
    async (_name, request) => {
      const token = 'private/token?with=characters&more'
      const original = Object.assign(new Error(`HTTP 503: ${token} ${encodeURIComponent(token)}`), {
        body: token,
        cause: new Error(token),
      })
      mockGet.mockRejectedValueOnce(original)

      const error = await request(createDeezerUserClient(token)).catch(
        (failure: unknown) => failure,
      )

      expect(error).toBeInstanceOf(Error)
      expect(error).not.toBe(original)
      expect(error).toMatchObject({
        message:
          'Deezer request failed: HTTP 503: [REDACTED] [REDACTED]. Check your Deezer connection in Settings and reconnect if needed.',
      })
      expect(error).not.toHaveProperty('cause')
      expect(error).not.toHaveProperty('body')
      expect(String(error)).not.toContain(token)
      expect(String(error)).not.toContain(encodeURIComponent(token))
    },
  )

  it.each(requests.slice(0, -1))('%s preserves successful empty feeds', async (_name, request) => {
    mockGet.mockResolvedValueOnce({ data: [] })

    await expect(request(createDeezerUserClient('test-token'))).resolves.toEqual([])
  })

  describe('getFavoriteArtists(limit)', () => {
    it('returns mapped artists from user favorites', async () => {
      mockGet.mockResolvedValueOnce({
        data: [{ id: 1, name: 'Fav Artist', nb_fan: 1000, link: 'https://deezer.com/artist/1' }],
        total: 1,
      })

      const client = createDeezerUserClient('test-token')
      const result = await client.getFavoriteArtists()

      expect(result).toEqual([{ id: 1, name: 'Fav Artist', fans: 1000 }])
      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('/user/me/artists'))
    })

    it('appends access_token query param', async () => {
      mockGet.mockResolvedValueOnce({ data: [] })

      const client = createDeezerUserClient('my-secret-token')
      await client.getFavoriteArtists()

      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('access_token=my-secret-token'))
    })

    it('uses provided limit', async () => {
      mockGet.mockResolvedValueOnce({ data: [] })

      const client = createDeezerUserClient('test-token')
      await client.getFavoriteArtists(25)

      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('limit=25'))
    })

    it('stops paging once the limit is reached', async () => {
      const page = (start: number) =>
        Array.from({ length: 3 }, (_, i) => ({ id: start + i, name: `A${start + i}`, nb_fan: 1 }))
      mockGet.mockResolvedValueOnce({ data: page(0), next: 'more' })

      const client = createDeezerUserClient('test-token')
      const result = await client.getFavoriteArtists(3)

      expect(result.map((a) => a.id)).toEqual([0, 1, 2])
      expect(mockGet).toHaveBeenCalledTimes(1)
    })

    it('returns empty array when data is absent', async () => {
      mockGet.mockResolvedValueOnce({})

      const client = createDeezerUserClient('test-token')
      const result = await client.getFavoriteArtists()

      expect(result).toEqual([])
    })
  })

  describe('getFollowedArtists(limit)', () => {
    it('returns followed artists', async () => {
      mockGet.mockResolvedValueOnce({
        data: [{ id: 2, name: 'Followed', nb_fan: 500, link: '' }],
        total: 1,
      })

      const client = createDeezerUserClient('test-token')
      const result = await client.getFollowedArtists()

      expect(result).toEqual([{ id: 2, name: 'Followed', fans: 500 }])
    })

    it('appends access_token query param', async () => {
      mockGet.mockResolvedValueOnce({ data: [] })

      const client = createDeezerUserClient('tok123')
      await client.getFollowedArtists()

      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('access_token=tok123'))
    })
  })

  describe('getFlowRecommendations(limit)', () => {
    it('returns recommended artists', async () => {
      mockGet.mockResolvedValueOnce({
        data: [{ id: 3, name: 'Flow Pick', nb_fan: 2000, link: '' }],
      })

      const client = createDeezerUserClient('test-token')
      const result = await client.getFlowRecommendations()

      expect(result).toEqual([{ id: 3, name: 'Flow Pick', fans: 2000 }])
    })

    it('calls recommendations/artists endpoint', async () => {
      mockGet.mockResolvedValueOnce({ data: [] })

      const client = createDeezerUserClient('test-token')
      await client.getFlowRecommendations()

      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('/user/me/recommendations/artists'),
      )
    })

    it('returns empty array when data is absent', async () => {
      mockGet.mockResolvedValueOnce({})

      const client = createDeezerUserClient('test-token')
      const result = await client.getFlowRecommendations()

      expect(result).toEqual([])
    })
  })

  describe('getPlaylists()', () => {
    it('returns user playlist summaries', async () => {
      mockGet.mockResolvedValueOnce({
        data: [{ id: 100, title: 'My Mix', nb_tracks: 25, picture_medium: 'img.jpg' }],
      })

      const client = createDeezerUserClient('test-token')
      const result = await client.getPlaylists()

      expect(result).toEqual([{ id: 100, title: 'My Mix', trackCount: 25, imageUrl: 'img.jpg' }])
    })

    it('omits imageUrl when picture_medium is undefined', async () => {
      mockGet.mockResolvedValueOnce({
        data: [{ id: 101, title: 'No Image', nb_tracks: 5 }],
      })

      const client = createDeezerUserClient('test-token')
      const result = await client.getPlaylists()

      expect(result[0]?.imageUrl).toBeUndefined()
    })

    it('calls /user/me/playlists endpoint', async () => {
      mockGet.mockResolvedValueOnce({ data: [] })

      const client = createDeezerUserClient('test-token')
      await client.getPlaylists()

      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('/user/me/playlists'))
    })
  })

  describe('getPlaylistTracks(playlistId)', () => {
    it('extracts artist names from playlist tracks', async () => {
      mockGet.mockResolvedValueOnce({
        data: [
          { id: 1, title: 'Song A', artist: { id: 10, name: 'Artist X' } },
          { id: 2, title: 'Song B', artist: { id: 20, name: 'Artist Y' } },
          { id: 3, title: 'Song C', artist: { id: 10, name: 'Artist X' } },
        ],
      })

      const client = createDeezerUserClient('test-token')
      const result = await client.getPlaylistTracks(100)

      expect(result).toEqual(['Artist X', 'Artist Y'])
    })

    it('deduplicates artist names case-insensitively', async () => {
      mockGet.mockResolvedValueOnce({
        data: [
          { id: 1, title: 'Song A', artist: { id: 10, name: 'Artist X' } },
          { id: 2, title: 'Song B', artist: { id: 10, name: 'artist x' } },
        ],
      })

      const client = createDeezerUserClient('test-token')
      const result = await client.getPlaylistTracks(200)

      expect(result).toEqual(['Artist X'])
    })

    it('calls the correct playlist tracks endpoint', async () => {
      mockGet.mockResolvedValueOnce({ data: [] })

      const client = createDeezerUserClient('test-token')
      await client.getPlaylistTracks(42)

      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('/playlist/42/tracks'))
      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('limit=500'))
    })

    it('returns empty array when data is absent', async () => {
      mockGet.mockResolvedValueOnce({})

      const client = createDeezerUserClient('test-token')
      const result = await client.getPlaylistTracks(1)

      expect(result).toEqual([])
    })
  })

  describe('pagination', () => {
    it('follows next with an advancing index and skips artist-less tracks', async () => {
      mockGet
        .mockResolvedValueOnce({
          data: [
            { id: 1, title: 'a', artist: { id: 1, name: 'A' } },
            { id: 2, title: 'b', artist: null },
          ],
          next: 'https://api.deezer.com/next',
        })
        .mockResolvedValueOnce({ data: [{ id: 3, title: 'c', artist: { id: 3, name: 'C' } }] })

      const result = await createDeezerUserClient('t').getPlaylistTracks(1)

      expect(result).toEqual(['A', 'C'])
      expect(mockGet).toHaveBeenNthCalledWith(1, expect.stringContaining('index=0'))
      expect(mockGet).toHaveBeenNthCalledWith(2, expect.stringContaining('index=2'))
    })

    it('pages playlists', async () => {
      mockGet
        .mockResolvedValueOnce({
          data: [{ id: 1, title: 'P1', nb_tracks: 1 }],
          next: 'x',
        })
        .mockResolvedValueOnce({ data: [{ id: 2, title: 'P2', nb_tracks: 2 }] })

      const result = await createDeezerUserClient('t').getPlaylists()

      expect(result.map((p) => p.id)).toEqual([1, 2])
    })
  })

  describe('getMe()', () => {
    it('returns user profile', async () => {
      mockGet.mockResolvedValueOnce({ id: 1, name: 'TestUser' })

      const client = createDeezerUserClient('test-token')
      const result = await client.getMe()

      expect(result).toEqual({ id: 1, name: 'TestUser' })
    })

    it('calls /user/me endpoint with access_token', async () => {
      mockGet.mockResolvedValueOnce({ id: 99, name: 'User' })

      const client = createDeezerUserClient('tok-abc')
      await client.getMe()

      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('/user/me'))
      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('access_token=tok-abc'))
    })
  })
})
