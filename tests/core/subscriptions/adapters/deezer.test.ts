// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDeezerAdapter } from '@/core/subscriptions/adapters/deezer'

vi.mock('@/core/clients/deezer-user', () => ({
  createDeezerUserClient: vi.fn(),
}))

import { createDeezerUserClient } from '@/core/clients/deezer-user'

const mockClient = {
  getFavoriteArtists: vi.fn(),
  getFollowedArtists: vi.fn(),
  getFlowRecommendations: vi.fn(),
  getPlaylists: vi.fn(),
  getPlaylistTracks: vi.fn(),
  getMe: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(createDeezerUserClient).mockReturnValue(mockClient)
})

describe('createDeezerAdapter', () => {
  it('has correct type, label, and configFields', () => {
    const adapter = createDeezerAdapter({ getToken: async () => 'tok' })
    expect(adapter.type).toBe('deezer')
    expect(adapter.label).toBe('Deezer')
    const keys = adapter.configFields.map((f) => f.key)
    expect(keys).toContain('feedType')
    expect(keys).toContain('playlistIds')
    const feedTypeField = adapter.configFields.find((f) => f.key === 'feedType')
    const values = feedTypeField?.options?.map((o) => o.value) ?? []
    expect(values).toContain('favorites')
    expect(values).toContain('followed')
    expect(values).toContain('flow')
    expect(values).toContain('playlists')
  })

  describe('favorites feed', () => {
    it('maps artists with score 0.85 and source deezer:favorites', async () => {
      mockClient.getFavoriteArtists.mockResolvedValue([
        { id: 1, name: 'Artist One', fans: 1000 },
        { id: 2, name: 'Artist Two', fans: 2000 },
      ])
      const adapter = createDeezerAdapter({ getToken: async () => 'tok' })
      const result = await adapter.fetch({ feedType: 'favorites' })

      expect(result.artists).toHaveLength(2)
      expect(result.artists[0]).toMatchObject({
        name: 'Artist One',
        similarityScore: 0.85,
        source: 'deezer:favorites',
      })
      expect(result.artists[1]).toMatchObject({
        name: 'Artist Two',
        similarityScore: 0.85,
        source: 'deezer:favorites',
      })
    })

    it('deduplicates by lowercase name', async () => {
      mockClient.getFavoriteArtists.mockResolvedValue([
        { id: 1, name: 'Radiohead', fans: 5000 },
        { id: 1, name: 'radiohead', fans: 5000 },
      ])
      const adapter = createDeezerAdapter({ getToken: async () => 'tok' })
      const result = await adapter.fetch({ feedType: 'favorites' })
      expect(result.artists).toHaveLength(1)
    })
  })

  describe('followed feed', () => {
    it('maps artists with score 0.8 and source deezer:followed', async () => {
      mockClient.getFollowedArtists.mockResolvedValue([{ id: 3, name: 'Portishead', fans: 3000 }])
      const adapter = createDeezerAdapter({ getToken: async () => 'tok' })
      const result = await adapter.fetch({ feedType: 'followed' })

      expect(result.artists).toHaveLength(1)
      expect(result.artists[0]).toMatchObject({
        name: 'Portishead',
        similarityScore: 0.8,
        source: 'deezer:followed',
      })
    })
  })

  describe('flow feed', () => {
    it('maps artists with score 0.7 and source deezer:flow', async () => {
      mockClient.getFlowRecommendations.mockResolvedValue([
        { id: 4, name: 'Massive Attack', fans: 8000 },
        { id: 5, name: 'Burial', fans: 4000 },
      ])
      const adapter = createDeezerAdapter({ getToken: async () => 'tok' })
      const result = await adapter.fetch({ feedType: 'flow' })

      expect(result.artists).toHaveLength(2)
      for (const artist of result.artists) {
        expect(artist.similarityScore).toBe(0.7)
        expect(artist.source).toBe('deezer:flow')
      }
    })
  })

  describe('playlists feed', () => {
    it('extracts artists from a single playlist', async () => {
      mockClient.getPlaylistTracks.mockResolvedValue(['Boards of Canada', 'Aphex Twin', 'Autechre'])
      const adapter = createDeezerAdapter({ getToken: async () => 'tok' })
      const result = await adapter.fetch({ feedType: 'playlists', playlistIds: '111' })

      expect(result.artists).toHaveLength(3)
      expect(result.artists[0]).toMatchObject({
        name: 'Boards of Canada',
        similarityScore: 0.6,
        source: 'deezer:playlists',
      })
    })

    it('deduplicates artists across multiple playlists', async () => {
      mockClient.getPlaylistTracks
        .mockResolvedValueOnce(['Radiohead', 'Portishead'])
        .mockResolvedValueOnce(['Portishead', 'Burial'])
      const adapter = createDeezerAdapter({ getToken: async () => 'tok' })
      const result = await adapter.fetch({ feedType: 'playlists', playlistIds: '111,222' })

      expect(result.artists).toHaveLength(3)
      const names = result.artists.map((a) => a.name)
      expect(names).toContain('Radiohead')
      expect(names).toContain('Portishead')
      expect(names).toContain('Burial')
    })

    it('enforces 500-artist cap across playlists', async () => {
      const bigList = Array.from({ length: 400 }, (_, i) => `Artist ${i}`)
      const bigList2 = Array.from({ length: 300 }, (_, i) => `Band ${i}`)
      mockClient.getPlaylistTracks.mockResolvedValueOnce(bigList).mockResolvedValueOnce(bigList2)
      const adapter = createDeezerAdapter({ getToken: async () => 'tok' })
      const result = await adapter.fetch({ feedType: 'playlists', playlistIds: '111,222' })

      expect(result.artists).toHaveLength(500)
    })

    it('returns empty when playlistIds is missing', async () => {
      const adapter = createDeezerAdapter({ getToken: async () => 'tok' })
      const result = await adapter.fetch({ feedType: 'playlists' })
      expect(result.artists).toHaveLength(0)
    })

    it('ignores non-numeric playlist IDs', async () => {
      const adapter = createDeezerAdapter({ getToken: async () => 'tok' })
      const result = await adapter.fetch({ feedType: 'playlists', playlistIds: 'abc,,' })
      expect(result.artists).toHaveLength(0)
      expect(mockClient.getPlaylistTracks).not.toHaveBeenCalled()
    })
  })

  describe('graceful degradation', () => {
    it('returns empty artists when getToken throws', async () => {
      const adapter = createDeezerAdapter({
        getToken: async () => {
          throw new Error('no token')
        },
      })
      const result = await adapter.fetch({ feedType: 'favorites' })
      expect(result.artists).toHaveLength(0)
    })
  })

  describe('unknown feed type', () => {
    it('returns empty artists', async () => {
      const adapter = createDeezerAdapter({ getToken: async () => 'tok' })
      const result = await adapter.fetch({ feedType: 'unknown' })
      expect(result.artists).toHaveLength(0)
    })

    it('returns empty when feedType is missing', async () => {
      const adapter = createDeezerAdapter({ getToken: async () => 'tok' })
      const result = await adapter.fetch({})
      expect(result.artists).toHaveLength(0)
    })
  })
})
