// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/core/clients/spotify', () => ({
  createSpotifyClient: vi.fn(),
}))

const { createSpotifyClient } = await import('@/core/clients/spotify')
const { createSpotifySource } = await import('@/core/plugins/spotify')

describe('createSpotifySource()', () => {
  function mockClient() {
    const client = {
      getTopArtists: vi.fn((range?: string) => {
        if (range === 'short_term')
          return Promise.resolve([
            { name: 'Radiohead', id: 'sp-rh', genres: ['art rock'], popularity: 90 },
          ])
        if (range === 'long_term')
          return Promise.resolve([
            { name: 'Bjork', id: 'sp-bj', genres: ['art pop'], popularity: 71 },
          ])
        // medium_term
        return Promise.resolve([
          { name: 'Radiohead', id: 'sp-rh', genres: ['alternative'], popularity: 82 },
        ])
      }),
      getRecentlyPlayed: vi.fn().mockResolvedValue([
        {
          name: 'Everything In Its Right Place',
          artists: [{ name: 'Radiohead', id: 'sp-rh' }],
          playedAt: '2025-01-15T10:30:00Z',
        },
        {
          name: 'Army of Me',
          artists: [{ name: 'Bjork', id: 'sp-bj' }],
          playedAt: '2025-01-15T10:25:00Z',
        },
      ]),
      searchTracks: vi.fn().mockResolvedValue([]),
      findExactArtistByName: vi.fn().mockResolvedValue(null),
      getPopularAlbumsForArtist: vi.fn().mockResolvedValue([]),
      getSavedAlbums: vi.fn().mockResolvedValue([]),
      getFollowedArtists: vi.fn().mockResolvedValue([]),
      testConnection: vi.fn().mockResolvedValue({
        success: true,
        message: 'Connected to Spotify as testuser',
        details: { userId: 'sp-user-123' },
      }),
    }
    vi.mocked(createSpotifyClient).mockReturnValue(client)
    return client
  }

  it('has id "spotify" and name "Spotify"', () => {
    mockClient()
    const source = createSpotifySource('access-token')
    expect(source.id).toBe('spotify')
    expect(source.name).toBe('Spotify')
  })

  it('has correct capabilities', () => {
    mockClient()
    const source = createSpotifySource('access-token')
    expect(source.capabilities).toContain('topArtists')
    expect(source.capabilities).toContain('recentListening')
    expect(source.capabilities).not.toContain('similarArtists')
    expect(source.capabilities).not.toContain('listeningActivity')
    expect(source.capabilities).not.toContain('genreArtists')
  })

  it('getTopArtists() merges all three windows: dedupes by name, unions genres, keeps max popularity', async () => {
    const client = mockClient()
    const source = createSpotifySource('access-token')
    const artists = await source.getTopArtists(50)

    expect(client.getTopArtists).toHaveBeenCalledTimes(3)
    expect(client.getTopArtists).toHaveBeenCalledWith('short_term', 50)
    expect(client.getTopArtists).toHaveBeenCalledWith('medium_term', 50)
    expect(client.getTopArtists).toHaveBeenCalledWith('long_term', 50)

    const rh = artists.find((a) => a.name === 'Radiohead')
    const bj = artists.find((a) => a.name === 'Bjork')
    expect(artists).toHaveLength(2)
    expect(rh).toEqual({
      name: 'Radiohead',
      playCount: 90, // max(90 short, 82 medium)
      source: 'spotify',
      genres: expect.arrayContaining(['art rock', 'alternative']),
    })
    expect(rh?.genres).toHaveLength(2) // unioned, no dupes
    expect(bj?.playCount).toBe(71)
  })

  it('getTopArtists() degrades gracefully when one window fails, keeping successful windows', async () => {
    const client = mockClient()
    client.getTopArtists.mockImplementation((range?: string) => {
      if (range === 'short_term') return Promise.reject(new Error('rate limited'))
      if (range === 'long_term')
        return Promise.resolve([{ name: 'Bjork', id: 'sp-bj', genres: ['art pop'], popularity: 71 }])
      return Promise.resolve([
        { name: 'Radiohead', id: 'sp-rh', genres: ['alternative'], popularity: 82 },
      ])
    })
    const source = createSpotifySource('access-token')
    const artists = await source.getTopArtists(50)

    const rh = artists.find((a) => a.name === 'Radiohead')
    const bj = artists.find((a) => a.name === 'Bjork')
    expect(artists).toHaveLength(2)
    expect(rh?.playCount).toBe(82) // only medium_term survived
    expect(rh?.genres).toEqual(['alternative'])
    expect(bj?.playCount).toBe(71)
  })

  it('getTopArtists() returns [] when all windows fail, without throwing', async () => {
    const client = mockClient()
    client.getTopArtists.mockRejectedValue(new Error('down'))
    const source = createSpotifySource('access-token')

    await expect(source.getTopArtists(50)).resolves.toEqual([])
  })

  it('getRecentListening() maps client response', async () => {
    mockClient()
    const source = createSpotifySource('access-token')
    const recent = await source.getRecentListening?.()

    expect(recent).toHaveLength(2)
    expect(recent?.[0]).toEqual({
      name: 'Radiohead',
      track: 'Everything In Its Right Place',
      playedAt: new Date('2025-01-15T10:30:00Z'),
    })
    expect(recent?.[1]).toEqual({
      name: 'Bjork',
      track: 'Army of Me',
      playedAt: new Date('2025-01-15T10:25:00Z'),
    })
  })

  it('testConnection() delegates to client', async () => {
    const client = mockClient()
    const source = createSpotifySource('access-token')
    const result = await source.testConnection()

    expect(result).toEqual({
      success: true,
      message: 'Connected to Spotify as testuser',
      details: { userId: 'sp-user-123' },
    })
    expect(client.testConnection).toHaveBeenCalled()
  })

  it('getSimilarArtists() returns empty array', async () => {
    mockClient()
    const source = createSpotifySource('access-token')
    const similar = await source.getSimilarArtists('Radiohead', 'mbid-rh')

    expect(similar).toEqual([])
  })

  it('does not have getListeningActivity', () => {
    mockClient()
    const source = createSpotifySource('access-token')
    expect(source.getListeningActivity).toBeUndefined()
  })

  it('does not have getGenreArtists', () => {
    mockClient()
    const source = createSpotifySource('access-token')
    expect(source.getGenreArtists).toBeUndefined()
  })
})
