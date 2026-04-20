// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/core/clients/lastfm', () => ({
  createLastFmClient: vi.fn(),
}))

const { createLastFmClient } = await import('@/core/clients/lastfm')
const { createLastFmSource } = await import('@/core/plugins/lastfm')

describe('createLastFmSource()', () => {
  function mockClient() {
    const client = {
      getTopArtists: vi.fn().mockResolvedValue([
        { name: 'Radiohead', mbid: 'mbid-rh', playCount: 600, source: 'lastfm' },
        { name: 'Bjork', mbid: 'mbid-bj', playCount: 400, source: 'lastfm' },
      ]),
      getSimilarArtists: vi.fn().mockResolvedValue([
        { name: 'Bjork', mbid: 'mbid-bj', similarityScore: 0.85, source: 'lastfm' },
        { name: 'Tricky', mbid: 'mbid-tr', similarityScore: 0.75, source: 'lastfm' },
      ]),
      testConnection: vi.fn().mockResolvedValue({ success: true, message: 'Connected' }),
      getTopArtistsPaged: vi.fn().mockResolvedValue({ artists: [], totalCount: 0 }),
      getRecentTracks: vi.fn().mockResolvedValue([]),
      getTopArtistsByTag: vi.fn().mockResolvedValue([
        { name: 'Portishead', mbid: 'mbid-pt', listeners: 1200000 },
        { name: 'Massive Attack', mbid: 'mbid-ma', listeners: 980000 },
      ]),
    }
    vi.mocked(createLastFmClient).mockReturnValue(client)
    return client
  }

  it('has id "lastfm" and name "Last.fm"', () => {
    mockClient()
    const source = createLastFmSource('user', 'key')
    expect(source.id).toBe('lastfm')
    expect(source.name).toBe('Last.fm')
  })

  it('has correct capabilities', () => {
    mockClient()
    const source = createLastFmSource('user', 'key')
    expect(source.capabilities).toContain('topArtists')
    expect(source.capabilities).toContain('similarArtists')
    expect(source.capabilities).toContain('genreArtists')
    expect(source.capabilities).not.toContain('listeningActivity')
    expect(source.capabilities).not.toContain('recentListening')
  })

  it('getTopArtists() maps client response to TopArtistEntry[]', async () => {
    mockClient()
    const source = createLastFmSource('user', 'key')
    const artists = await source.getTopArtists()

    expect(artists).toHaveLength(2)
    expect(artists[0]).toEqual({
      name: 'Radiohead',
      mbid: 'mbid-rh',
      playCount: 600,
      source: 'lastfm',
    })
  })

  it('getSimilarArtists() maps client response to SimilarArtistEntry[]', async () => {
    const client = mockClient()
    const source = createLastFmSource('user', 'key')
    const similar = await source.getSimilarArtists('Radiohead', 'mbid-rh')

    expect(similar).toHaveLength(2)
    expect(similar[0]).toEqual({
      name: 'Bjork',
      mbid: 'mbid-bj',
      similarityScore: 0.85,
      source: 'lastfm',
    })
    expect(client.getSimilarArtists).toHaveBeenCalledWith('Radiohead', 'mbid-rh')
  })

  it('getSimilarArtists() works without mbid', async () => {
    const client = mockClient()
    const source = createLastFmSource('user', 'key')
    await source.getSimilarArtists('Radiohead')

    expect(client.getSimilarArtists).toHaveBeenCalledWith('Radiohead', undefined)
  })

  it('testConnection() delegates to client', async () => {
    const client = mockClient()
    const source = createLastFmSource('user', 'key')
    const result = await source.testConnection()

    expect(result).toEqual({ success: true, message: 'Connected' })
    expect(client.testConnection).toHaveBeenCalled()
  })

  it('does not have getListeningActivity', () => {
    mockClient()
    const source = createLastFmSource('user', 'key')
    expect(source.getListeningActivity).toBeUndefined()
  })

  it('getGenreArtists() is defined on lastfm source', () => {
    mockClient()
    const source = createLastFmSource('user', 'key')
    expect(source.getGenreArtists).toBeDefined()
  })

  it('getGenreArtists() maps client response to GenreArtistEntry[]', async () => {
    const client = mockClient()
    const source = createLastFmSource('user', 'key')
    const artists = await source.getGenreArtists?.('trip-hop')

    expect(artists).toHaveLength(2)
    expect(artists?.[0]).toEqual({
      name: 'Portishead',
      mbid: 'mbid-pt',
      listeners: 1200000,
      source: 'lastfm',
    })
    expect(client.getTopArtistsByTag).toHaveBeenCalledWith('trip-hop', undefined)
  })

  it('getGenreArtists() passes limit option to client', async () => {
    const client = mockClient()
    const source = createLastFmSource('user', 'key')
    await source.getGenreArtists?.('electronic', { limit: 10 })

    expect(client.getTopArtistsByTag).toHaveBeenCalledWith('electronic', 10)
  })
})
