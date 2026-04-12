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
    })

    it('returns empty array when data is absent', async () => {
      mockGet.mockResolvedValueOnce({})

      const client = createDeezerUserClient('test-token')
      const result = await client.getPlaylistTracks(1)

      expect(result).toEqual([])
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
