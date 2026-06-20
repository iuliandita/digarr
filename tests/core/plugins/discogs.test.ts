// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/core/clients/discogs', () => ({
  createDiscogsClient: vi.fn(),
}))

const { createDiscogsClient } = await import('@/core/clients/discogs')
const { createDiscogsSource } = await import('@/core/plugins/discogs')

describe('createDiscogsSource()', () => {
  function mockClient() {
    const client = {
      getCollectionArtists: vi.fn().mockResolvedValue([
        { name: 'Radiohead', id: 1, count: 5 },
        { name: 'Bjork', id: 2, count: 3 },
      ]),
      getWantlistArtists: vi.fn().mockResolvedValue([
        { name: 'Bjork', id: 2, count: 2 },
        { name: 'Portishead', id: 3, count: 1 },
      ]),
      searchByGenre: vi.fn().mockResolvedValue([
        { name: 'Massive Attack', id: 10 },
        { name: 'Tricky', id: 11 },
      ]),
      getLabelsForArtist: vi.fn().mockResolvedValue([]),
      getArtistsForLabel: vi.fn().mockResolvedValue([]),
      testConnection: vi.fn().mockResolvedValue({
        success: true,
        message: 'Connected to Discogs as testuser',
      }),
    }
    vi.mocked(createDiscogsClient).mockReturnValue(client)
    return client
  }

  it('has id "discogs" and name "Discogs"', () => {
    mockClient()
    const source = createDiscogsSource('token', 'testuser')
    expect(source.id).toBe('discogs')
    expect(source.name).toBe('Discogs')
  })

  it('has correct capabilities', () => {
    mockClient()
    const source = createDiscogsSource('token', 'testuser')
    expect(source.capabilities).toContain('topArtists')
    expect(source.capabilities).toContain('genreArtists')
    expect(source.capabilities).not.toContain('similarArtists')
    expect(source.capabilities).not.toContain('recentListening')
  })

  it('getTopArtists() merges collection and wantlist with dedup', async () => {
    mockClient()
    const source = createDiscogsSource('token', 'testuser')
    const artists = await source.getTopArtists()

    // Bjork in both: collection count 3 + wantlist count 2 = 5, ties with Radiohead (5)
    // Bjork appears second in collection so Radiohead keeps position if counts equal
    expect(artists).toHaveLength(3)

    // Bjork: 3 + 2 = 5, Radiohead: 5, Portishead: 1
    // Sort is by count desc. Bjork and Radiohead both 5, Portishead 1
    const bjork = artists.find((a) => a.name === 'Bjork')
    expect(bjork).toEqual({ name: 'Bjork', playCount: 5, source: 'discogs' })

    const radiohead = artists.find((a) => a.name === 'Radiohead')
    expect(radiohead).toEqual({ name: 'Radiohead', playCount: 5, source: 'discogs' })

    const portishead = artists.find((a) => a.name === 'Portishead')
    expect(portishead).toEqual({ name: 'Portishead', playCount: 1, source: 'discogs' })
  })

  it('getTopArtists() sorts merged results by count descending', async () => {
    mockClient()
    const source = createDiscogsSource('token', 'testuser')
    const artists = await source.getTopArtists()

    // Both Bjork and Radiohead have count 5, Portishead has 1
    const last = artists[artists.length - 1]
    expect(last?.name).toBe('Portishead')
    expect(last?.playCount).toBe(1)
  })

  it('getSimilarArtists() returns empty array', async () => {
    mockClient()
    const source = createDiscogsSource('token', 'testuser')
    const similar = await source.getSimilarArtists('Radiohead')
    expect(similar).toEqual([])
  })

  it('testConnection() delegates to client', async () => {
    const client = mockClient()
    const source = createDiscogsSource('token', 'testuser')
    const result = await source.testConnection()

    expect(result).toEqual({
      success: true,
      message: 'Connected to Discogs as testuser',
    })
    expect(client.testConnection).toHaveBeenCalled()
  })

  it('getGenreArtists() maps search results to GenreArtistEntry[]', async () => {
    const client = mockClient()
    const source = createDiscogsSource('token', 'testuser')
    const artists = await source.getGenreArtists?.('trip-hop')

    expect(artists).toHaveLength(2)
    expect(artists?.[0]).toEqual({
      name: 'Massive Attack',
      listeners: 0,
      source: 'discogs',
    })
    expect(artists?.[1]).toEqual({
      name: 'Tricky',
      listeners: 0,
      source: 'discogs',
    })
    expect(client.searchByGenre).toHaveBeenCalledWith('trip-hop', undefined)
  })

  it('getGenreArtists() passes limit option to client', async () => {
    const client = mockClient()
    const source = createDiscogsSource('token', 'testuser')
    await source.getGenreArtists?.('electronic', { limit: 10 })

    expect(client.searchByGenre).toHaveBeenCalledWith('electronic', 10)
  })
})
