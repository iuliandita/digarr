// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/core/clients/jellyfin', () => ({
  createJellyfinClient: vi.fn(),
}))

const { createJellyfinClient } = await import('@/core/clients/jellyfin')
const { createJellyfinSource } = await import('@/core/plugins/jellyfin')

describe('createJellyfinSource()', () => {
  function mockClient() {
    const client = {
      getTopArtists: vi.fn().mockResolvedValue([
        { name: 'Bjork', id: 'jf-1', playCount: 100, isFavorite: false },
        { name: 'Radiohead', id: 'jf-2', playCount: 80, isFavorite: false },
      ]),
      getFavoriteArtists: vi.fn().mockResolvedValue([
        { name: 'Bjork', id: 'jf-1', playCount: 100, isFavorite: true },
        { name: 'Portishead', id: 'jf-3', playCount: 0, isFavorite: true },
      ]),
      getRecentlyPlayed: vi.fn().mockResolvedValue([
        {
          artistName: 'Bjork',
          trackName: 'Hyperballad',
          datePlayed: '2024-06-15T10:30:00.000Z',
        },
        {
          artistName: 'Radiohead',
          trackName: 'Everything In Its Right Place',
          datePlayed: '2024-06-14T22:00:00.000Z',
        },
      ]),
      testConnection: vi.fn().mockResolvedValue({
        success: true,
        message: 'Connected to Jellyfin "MyServer" v10.9.0 - 2 top artist(s)',
      }),
    }
    vi.mocked(createJellyfinClient).mockReturnValue(client as never)
    return client
  }

  it('has correct id, name, and capabilities', () => {
    mockClient()
    const source = createJellyfinSource('http://jf:8096', 'key', 'uid')
    expect(source.id).toBe('jellyfin')
    expect(source.name).toBe('Jellyfin')
    expect(source.capabilities).toContain('topArtists')
    expect(source.capabilities).toContain('recentListening')
    expect(source.capabilities).not.toContain('similarArtists')
    expect(source.capabilities).not.toContain('listeningActivity')
  })

  it('getTopArtists() merges favorites and play-count artists', async () => {
    mockClient()
    const source = createJellyfinSource('http://jf:8096', 'key', 'uid')
    const artists = await source.getTopArtists()

    // Bjork: 100 plays + favorite = 120 (1.2x boost)
    const bjork = artists.find((a) => a.name === 'Bjork')
    expect(bjork).toBeDefined()
    expect(bjork?.playCount).toBe(120)

    // Radiohead: 80 plays, not a favorite, unchanged
    const radiohead = artists.find((a) => a.name === 'Radiohead')
    expect(radiohead).toBeDefined()
    expect(radiohead?.playCount).toBe(80)

    // Portishead: favorite with 0 plays, added with min 1
    const portishead = artists.find((a) => a.name === 'Portishead')
    expect(portishead).toBeDefined()
    expect(portishead?.playCount).toBe(1)

    // All entries have source 'jellyfin'
    for (const a of artists) {
      expect(a.source).toBe('jellyfin')
    }

    // Sorted by play count descending
    expect(artists.map((a) => a.name)).toEqual(['Bjork', 'Radiohead', 'Portishead'])
  })

  it('getRecentListening() maps client response', async () => {
    mockClient()
    const source = createJellyfinSource('http://jf:8096', 'key', 'uid')
    const recent = await source.getRecentListening?.()

    expect(recent).toHaveLength(2)
    expect(recent?.[0]).toEqual({
      name: 'Bjork',
      track: 'Hyperballad',
      playedAt: new Date('2024-06-15T10:30:00.000Z'),
    })
    expect(recent?.[1]).toEqual({
      name: 'Radiohead',
      track: 'Everything In Its Right Place',
      playedAt: new Date('2024-06-14T22:00:00.000Z'),
    })
  })

  it('testConnection() delegates to client', async () => {
    const client = mockClient()
    const source = createJellyfinSource('http://jf:8096', 'key', 'uid')
    const result = await source.testConnection()

    expect(result.success).toBe(true)
    expect(client.testConnection).toHaveBeenCalled()
  })

  it('getSimilarArtists() returns empty array', async () => {
    mockClient()
    const source = createJellyfinSource('http://jf:8096', 'key', 'uid')
    const similar = await source.getSimilarArtists('Bjork')
    expect(similar).toEqual([])
  })
})
