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
      getIdentity: vi.fn().mockResolvedValue({ machineIdentifier: 'machine-1' }),
      getAccounts: vi.fn().mockResolvedValue([{ id: 7, name: 'Listener' }]),
      getMusicSectionId: vi.fn().mockResolvedValue('1'),
      getMusicSections: vi.fn().mockResolvedValue([{ key: '1', title: 'Music' }]),
      getHistory: vi.fn().mockResolvedValue([]),
      getTopArtists: vi.fn().mockResolvedValue([
        { name: 'Radiohead', viewCount: 500, ratingKey: '100' },
        { name: 'Bjork', viewCount: 300, ratingKey: '101' },
      ]),
      getTopArtistsPaged: vi.fn().mockResolvedValue({ artists: [], totalCount: 0 }),
      getAllArtists: vi.fn().mockResolvedValue([]),
      getAlbumsForArtist: vi.fn().mockResolvedValue([]),
      getRecentlyPlayed: vi.fn().mockResolvedValue([
        {
          artistName: 'Portishead',
          trackName: 'Wandering Star',
          viewedAt: 1710000000000,
          artistRatingKey: '102',
        },
        {
          artistName: 'Massive Attack',
          trackName: 'Teardrop',
          viewedAt: 1709990000000,
          artistRatingKey: '103',
        },
      ]),
      getSimilarArtists: vi
        .fn()
        .mockResolvedValue([{ name: 'Atoms for Peace', guid: 'plex://artist/atoms' }]),
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

  it('passes the verified listener binding to the Plex client', () => {
    mockClient()

    createPlexSource('http://plex:32400', 'token', '1', 7, 'machine-1')

    expect(createPlexClient).toHaveBeenCalledWith('http://plex:32400', 'token', {
      sectionId: '1',
      accountId: 7,
      machineIdentifier: 'machine-1',
    })
  })

  it('has correct capabilities', () => {
    mockClient()
    const source = createPlexSource('http://plex:32400', 'token')
    expect(source.capabilities).toContain('topArtists')
    expect(source.capabilities).toContain('recentListening')
    expect(source.capabilities).toContain('similarArtists')
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

  it('getSimilarArtists() uses the artist rating key learned from listener history', async () => {
    const client = mockClient()
    const source = createPlexSource('http://plex:32400', 'token')
    await source.getTopArtists()
    const similar = await source.getSimilarArtists('Radiohead')

    expect(client.getSimilarArtists).toHaveBeenCalledWith('100')
    expect(similar).toEqual([
      {
        name: 'Atoms for Peace',
        mbid: undefined,
        similarityScore: 1,
        source: 'plex',
      },
    ])
  })

  it('getSimilarArtists() returns empty when the artist is absent from listener history', async () => {
    const client = mockClient()
    const source = createPlexSource('http://plex:32400', 'token')

    await expect(source.getSimilarArtists('Unknown artist')).resolves.toEqual([])
    expect(client.getSimilarArtists).not.toHaveBeenCalled()
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
