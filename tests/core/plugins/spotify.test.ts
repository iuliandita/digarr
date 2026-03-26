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
      getTopArtists: vi.fn().mockResolvedValue([
        { name: 'Radiohead', id: 'sp-rh', genres: ['art rock', 'alternative'], popularity: 82 },
        { name: 'Bjork', id: 'sp-bj', genres: ['art pop', 'electronic'], popularity: 71 },
      ]),
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

  it('getTopArtists() maps client response to TopArtistEntry[]', async () => {
    mockClient()
    const source = createSpotifySource('access-token')
    const artists = await source.getTopArtists()

    expect(artists).toHaveLength(2)
    expect(artists[0]).toEqual({
      name: 'Radiohead',
      playCount: 82,
      source: 'spotify',
    })
    expect(artists[1]).toEqual({
      name: 'Bjork',
      playCount: 71,
      source: 'spotify',
    })
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
