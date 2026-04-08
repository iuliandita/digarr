// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/core/clients/plex', () => ({
  createPlexClient: vi.fn(),
}))

const { createPlexClient } = await import('@/core/clients/plex')
const { createPlexSource } = await import('@/core/plugins/plex')

describe('createPlexSource()', () => {
  function mockClient() {
    const client = {
      getMusicSectionId: vi.fn().mockResolvedValue('1'),
      getTopArtists: vi.fn().mockResolvedValue([
        { name: 'Radiohead', viewCount: 500, ratingKey: '100' },
        { name: 'Bjork', viewCount: 300, ratingKey: '101' },
      ]),
      getAllArtists: vi.fn().mockResolvedValue([]),
      getAlbumsForArtist: vi.fn().mockResolvedValue([]),
      getRecentlyPlayed: vi.fn().mockResolvedValue([
        { artistName: 'Portishead', trackName: 'Wandering Star', viewedAt: 1710000000000 },
        { artistName: 'Massive Attack', trackName: 'Teardrop', viewedAt: 1709990000000 },
      ]),
      testConnection: vi.fn().mockResolvedValue({ success: true, message: 'Connected' }),
    }
    vi.mocked(createPlexClient).mockReturnValue(client)
    return client
  }

  it('has id "plex" and name "Plex"', () => {
    mockClient()
    const source = createPlexSource('http://plex:32400', 'token')
    expect(source.id).toBe('plex')
    expect(source.name).toBe('Plex')
  })

  it('has correct capabilities', () => {
    mockClient()
    const source = createPlexSource('http://plex:32400', 'token')
    expect(source.capabilities).toContain('topArtists')
    expect(source.capabilities).toContain('recentListening')
    expect(source.capabilities).not.toContain('similarArtists')
    expect(source.capabilities).not.toContain('listeningActivity')
    expect(source.capabilities).not.toContain('genreArtists')
  })

  it('getTopArtists() maps viewCount to playCount', async () => {
    mockClient()
    const source = createPlexSource('http://plex:32400', 'token')
    const artists = await source.getTopArtists()

    expect(artists).toHaveLength(2)
    expect(artists[0]).toEqual({
      name: 'Radiohead',
      playCount: 500,
      source: 'plex',
    })
    expect(artists[1]).toEqual({
      name: 'Bjork',
      playCount: 300,
      source: 'plex',
    })
  })

  it('getTopArtists() passes limit to client', async () => {
    const client = mockClient()
    const source = createPlexSource('http://plex:32400', 'token')
    await source.getTopArtists(10)

    expect(client.getTopArtists).toHaveBeenCalledWith(10)
  })

  it('getRecentListening() maps client response', async () => {
    mockClient()
    const source = createPlexSource('http://plex:32400', 'token')
    const tracks = await source.getRecentListening?.()

    expect(tracks).toHaveLength(2)
    expect(tracks?.[0]).toEqual({
      name: 'Portishead',
      track: 'Wandering Star',
      playedAt: new Date(1710000000000),
    })
    expect(tracks?.[1]).toEqual({
      name: 'Massive Attack',
      track: 'Teardrop',
      playedAt: new Date(1709990000000),
    })
  })

  it('getRecentListening() passes limit to client', async () => {
    const client = mockClient()
    const source = createPlexSource('http://plex:32400', 'token')
    await source.getRecentListening?.(25)

    expect(client.getRecentlyPlayed).toHaveBeenCalledWith(25)
  })

  it('getSimilarArtists() returns empty array', async () => {
    mockClient()
    const source = createPlexSource('http://plex:32400', 'token')
    const similar = await source.getSimilarArtists('Radiohead', 'mbid-rh')

    expect(similar).toEqual([])
  })

  it('testConnection() delegates to client', async () => {
    const client = mockClient()
    const source = createPlexSource('http://plex:32400', 'token')
    const result = await source.testConnection()

    expect(result).toEqual({ success: true, message: 'Connected' })
    expect(client.testConnection).toHaveBeenCalled()
  })

  it('does not have getListeningActivity', () => {
    mockClient()
    const source = createPlexSource('http://plex:32400', 'token')
    expect(source.getListeningActivity).toBeUndefined()
  })

  it('does not have getGenreArtists', () => {
    mockClient()
    const source = createPlexSource('http://plex:32400', 'token')
    expect(source.getGenreArtists).toBeUndefined()
  })
})
