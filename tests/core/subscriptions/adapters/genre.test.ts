// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { DiscoverySource, GenreArtistEntry } from '@/core/plugins/types'
import { createGenreAdapter } from '@/core/subscriptions/adapters/genre'

function makeSource(
  id: string,
  hasGenreArtists: boolean,
  entries: GenreArtistEntry[] = [],
): DiscoverySource {
  return {
    id,
    name: `Source ${id}`,
    capabilities: hasGenreArtists ? ['genreArtists'] : ['topArtists'],
    getTopArtists: vi.fn().mockResolvedValue([]),
    getSimilarArtists: vi.fn().mockResolvedValue([]),
    testConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
    getGenreArtists: hasGenreArtists ? vi.fn().mockResolvedValue(entries) : undefined,
  }
}

describe('createGenreAdapter', () => {
  function requireArtist<T>(value: T | undefined, message: string): T {
    if (value === undefined) {
      throw new Error(message)
    }
    return value
  }

  it('has correct type and label', () => {
    const adapter = createGenreAdapter([])
    expect(adapter.type).toBe('genre')
    expect(adapter.label).toBeTruthy()
  })

  it('has genre and providers configFields', () => {
    const adapter = createGenreAdapter([])
    const keys = adapter.configFields.map((f) => f.key)
    expect(keys).toContain('genre')
    expect(keys).toContain('providers')
  })

  it('fetches genre artists from capable sources', async () => {
    const entries: GenreArtistEntry[] = [
      { name: 'Artist A', mbid: 'mbid-a', listeners: 500_000, source: 'lastfm' },
      { name: 'Artist B', mbid: undefined, listeners: 0, source: 'lastfm' },
    ]
    const source = makeSource('lastfm', true, entries)
    const adapter = createGenreAdapter([source])

    const result = await adapter.fetch({ genre: 'metal' })

    expect(result.artists).toHaveLength(2)
    const firstArtist = requireArtist(result.artists[0], 'Expected first genre artist')
    expect(firstArtist.name).toBe('Artist A')
    expect(firstArtist.mbid).toBe('mbid-a')
    expect(firstArtist.source).toBe('genre-subscription:lastfm')
    // 500_000 / 1_000_000 = 0.5
    expect(firstArtist.similarityScore).toBeCloseTo(0.5)
  })

  it('uses 0.5 default similarityScore when listeners is 0', async () => {
    const entries: GenreArtistEntry[] = [{ name: 'Artist B', listeners: 0, source: 'lastfm' }]
    const source = makeSource('lastfm', true, entries)
    const adapter = createGenreAdapter([source])

    const result = await adapter.fetch({ genre: 'folk' })

    const firstArtist = requireArtist(result.artists[0], 'Expected first genre artist')
    expect(firstArtist.similarityScore).toBe(0.5)
  })

  it('caps similarityScore at 1.0 for very high listener counts', async () => {
    const entries: GenreArtistEntry[] = [
      { name: 'Huge Artist', listeners: 5_000_000, source: 'lastfm' },
    ]
    const source = makeSource('lastfm', true, entries)
    const adapter = createGenreAdapter([source])

    const result = await adapter.fetch({ genre: 'pop' })

    const firstArtist = requireArtist(result.artists[0], 'Expected first genre artist')
    expect(firstArtist.similarityScore).toBe(1.0)
  })

  it('skips sources without genreArtists capability', async () => {
    const capable = makeSource('lastfm', true, [
      { name: 'Artist A', listeners: 100_000, source: 'lastfm' },
    ])
    const incapable = makeSource('listenbrainz', false, [])

    const adapter = createGenreAdapter([capable, incapable])
    const result = await adapter.fetch({ genre: 'jazz' })

    expect(result.artists).toHaveLength(1)
    const firstArtist = requireArtist(result.artists[0], 'Expected first genre artist')
    expect(firstArtist.name).toBe('Artist A')
  })

  it('returns empty when no capable sources exist', async () => {
    const source = makeSource('listenbrainz', false)
    const adapter = createGenreAdapter([source])

    const result = await adapter.fetch({ genre: 'classical' })

    expect(result.artists).toHaveLength(0)
  })

  it('filters sources by providers config when provided', async () => {
    const lastfm = makeSource('lastfm', true, [
      { name: 'Artist A', listeners: 100_000, source: 'lastfm' },
    ])
    const musicbrainz = makeSource('musicbrainz', true, [
      { name: 'Artist B', listeners: 200_000, source: 'musicbrainz' },
    ])
    const adapter = createGenreAdapter([lastfm, musicbrainz])

    const result = await adapter.fetch({ genre: 'rock', providers: ['musicbrainz'] })

    expect(result.artists).toHaveLength(1)
    const firstArtist = requireArtist(result.artists[0], 'Expected first genre artist')
    expect(firstArtist.name).toBe('Artist B')
  })

  it('merges results from multiple capable sources', async () => {
    const lastfm = makeSource('lastfm', true, [
      { name: 'Artist A', listeners: 100_000, source: 'lastfm' },
    ])
    const musicbrainz = makeSource('musicbrainz', true, [
      { name: 'Artist B', listeners: 200_000, source: 'musicbrainz' },
    ])
    const adapter = createGenreAdapter([lastfm, musicbrainz])

    const result = await adapter.fetch({ genre: 'rock' })

    expect(result.artists).toHaveLength(2)
  })

  it('passes limit option to getGenreArtists', async () => {
    const getGenreArtists = vi.fn().mockResolvedValue([])
    const source: DiscoverySource = {
      id: 'lastfm',
      name: 'Last.fm',
      capabilities: ['genreArtists'],
      getTopArtists: vi.fn().mockResolvedValue([]),
      getSimilarArtists: vi.fn().mockResolvedValue([]),
      testConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
      getGenreArtists,
    }
    const adapter = createGenreAdapter([source])

    await adapter.fetch({ genre: 'metal' }, { limit: 10 })

    expect(getGenreArtists).toHaveBeenCalledWith('metal', { limit: 10 })
  })
})
