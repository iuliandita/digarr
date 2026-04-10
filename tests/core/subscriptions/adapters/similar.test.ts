// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { DiscoverySource, SimilarArtistEntry } from '@/core/plugins/types'
import { createSimilarAdapter } from '@/core/subscriptions/adapters/similar'

function makeSource(id: string, entries: SimilarArtistEntry[] = []): DiscoverySource {
  return {
    id,
    name: `Source ${id}`,
    capabilities: ['similarArtists'],
    getTopArtists: vi.fn().mockResolvedValue([]),
    getSimilarArtists: vi.fn().mockResolvedValue(entries),
    testConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
  }
}

function makeIncapableSource(id: string): DiscoverySource {
  return {
    id,
    name: `Source ${id}`,
    capabilities: ['topArtists'],
    getTopArtists: vi.fn().mockResolvedValue([]),
    getSimilarArtists: vi.fn().mockResolvedValue([]),
    testConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
  }
}

describe('createSimilarAdapter', () => {
  function requireArtist<T>(value: T | undefined, message: string): T {
    if (value === undefined) {
      throw new Error(message)
    }
    return value
  }

  it('has correct type and label', () => {
    const adapter = createSimilarAdapter([])
    expect(adapter.type).toBe('similar')
    expect(adapter.label).toBeTruthy()
  })

  it('has seedArtists and providers configFields', () => {
    const adapter = createSimilarAdapter([])
    const keys = adapter.configFields.map((f) => f.key)
    expect(keys).toContain('seedArtists')
    expect(keys).toContain('providers')
  })

  it('fetches similar artists for each seed from each capable source', async () => {
    const entries: SimilarArtistEntry[] = [
      { name: 'Artist B', mbid: 'mbid-b', similarityScore: 0.8, source: 'lastfm' },
    ]
    const source = makeSource('lastfm', entries)
    const adapter = createSimilarAdapter([source])

    const result = await adapter.fetch({
      seedArtists: [{ name: 'Artist A', mbid: 'mbid-a' }],
    })

    expect(result.artists).toHaveLength(1)
    const firstArtist = requireArtist(result.artists[0], 'Expected first similar artist')
    expect(firstArtist.name).toBe('Artist B')
    expect(firstArtist.mbid).toBe('mbid-b')
    expect(firstArtist.similarityScore).toBe(0.8)
    expect(firstArtist.source).toBe('similar-subscription:lastfm')
  })

  it('passes seed name and mbid to getSimilarArtists', async () => {
    const getSimilarArtists = vi.fn().mockResolvedValue([])
    const source: DiscoverySource = {
      id: 'lastfm',
      name: 'Last.fm',
      capabilities: ['similarArtists'],
      getTopArtists: vi.fn().mockResolvedValue([]),
      getSimilarArtists,
      testConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
    }
    const adapter = createSimilarAdapter([source])

    await adapter.fetch({ seedArtists: [{ name: 'Radiohead', mbid: 'mbid-rh' }] })

    expect(getSimilarArtists).toHaveBeenCalledWith('Radiohead', 'mbid-rh')
  })

  it('resolves missing MBIDs before calling ListenBrainz', async () => {
    const listenbrainz = makeSource('listenbrainz', [
      { name: 'Artist B', similarityScore: 0.8, source: 'listenbrainz' },
    ])
    const searchArtist = vi.fn().mockResolvedValue({
      artists: [{ id: 'mbid-seed', name: 'Artist A', score: 100 }],
    })
    const adapter = createSimilarAdapter([listenbrainz], { searchArtist })

    await adapter.fetch({
      seedArtists: [{ name: 'Artist A' }],
      providers: ['listenbrainz'],
    })

    expect(searchArtist).toHaveBeenCalledWith('Artist A')
    expect(listenbrainz.getSimilarArtists).toHaveBeenCalledWith('Artist A', 'mbid-seed')
  })

  it('deduplicates artists across seeds by lowercase name', async () => {
    const source = makeSource('lastfm', [])
    const getSimilarFn = vi.mocked(source.getSimilarArtists)
    // Seed 1 returns Artist C; Seed 2 also returns artist c (different case)
    getSimilarFn
      .mockResolvedValueOnce([{ name: 'Artist C', similarityScore: 0.9, source: 'lastfm' }])
      .mockResolvedValueOnce([{ name: 'artist c', similarityScore: 0.7, source: 'lastfm' }])

    const adapter = createSimilarAdapter([source])
    const result = await adapter.fetch({
      seedArtists: [{ name: 'Artist A' }, { name: 'Artist B' }],
    })

    expect(result.artists).toHaveLength(1)
    // First occurrence wins
    const firstArtist = requireArtist(result.artists[0], 'Expected first similar artist')
    expect(firstArtist.name).toBe('Artist C')
  })

  it('returns empty when no seed artists provided', async () => {
    const source = makeSource('lastfm', [])
    const adapter = createSimilarAdapter([source])

    const result = await adapter.fetch({ seedArtists: [] })

    expect(result.artists).toHaveLength(0)
    expect(source.getSimilarArtists).not.toHaveBeenCalled()
  })

  it('returns empty when seedArtists is missing from config', async () => {
    const source = makeSource('lastfm', [])
    const adapter = createSimilarAdapter([source])

    const result = await adapter.fetch({})

    expect(result.artists).toHaveLength(0)
  })

  it('skips sources without similarArtists capability', async () => {
    const capable = makeSource('lastfm', [
      { name: 'Artist B', similarityScore: 0.8, source: 'lastfm' },
    ])
    const incapable = makeIncapableSource('listenbrainz')

    const adapter = createSimilarAdapter([capable, incapable])
    const result = await adapter.fetch({
      seedArtists: [{ name: 'Artist A' }],
    })

    expect(result.artists).toHaveLength(1)
    expect(incapable.getSimilarArtists).not.toHaveBeenCalled()
  })

  it('filters sources by providers config when provided', async () => {
    const lastfm = makeSource('lastfm', [
      { name: 'Artist B', similarityScore: 0.8, source: 'lastfm' },
    ])
    const listenbrainz = makeSource('listenbrainz', [
      { name: 'Artist C', similarityScore: 0.7, source: 'listenbrainz' },
    ])
    const adapter = createSimilarAdapter([lastfm, listenbrainz])

    const result = await adapter.fetch({
      seedArtists: [{ name: 'Artist A' }],
      providers: ['lastfm'],
    })

    expect(result.artists).toHaveLength(1)
    const firstArtist = requireArtist(result.artists[0], 'Expected first similar artist')
    expect(firstArtist.name).toBe('Artist B')
    expect(listenbrainz.getSimilarArtists).not.toHaveBeenCalled()
  })

  it('merges results from multiple seeds and sources', async () => {
    const lastfm = makeSource('lastfm', [])
    const lb = makeSource('listenbrainz', [])
    vi.mocked(lastfm.getSimilarArtists)
      .mockResolvedValueOnce([{ name: 'Artist B', similarityScore: 0.9, source: 'lastfm' }])
      .mockResolvedValueOnce([{ name: 'Artist C', similarityScore: 0.7, source: 'lastfm' }])
    vi.mocked(lb.getSimilarArtists)
      .mockResolvedValueOnce([{ name: 'Artist D', similarityScore: 0.6, source: 'listenbrainz' }])
      .mockResolvedValueOnce([{ name: 'Artist E', similarityScore: 0.5, source: 'listenbrainz' }])

    const adapter = createSimilarAdapter([lastfm, lb])
    const result = await adapter.fetch({
      seedArtists: [{ name: 'Seed A' }, { name: 'Seed B' }],
    })

    // 2 seeds x 2 sources = 4 unique entries
    expect(result.artists).toHaveLength(4)
  })
})
