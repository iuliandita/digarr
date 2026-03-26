// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import type { SearchResult, SearchSource } from '@/core/search/multi-source'
import { multiSourceSearch } from '@/core/search/multi-source'

function makeSource(id: string, results: SearchResult[], available = true): SearchSource {
  return {
    id,
    name: id,
    available,
    search: vi.fn().mockResolvedValue(results),
  }
}

const mbid1 = '11111111-1111-1111-1111-111111111111'
const mbid2 = '22222222-2222-2222-2222-222222222222'

describe('multiSourceSearch', () => {
  it('fans out to multiple sources and merges by MBID', async () => {
    const r1: SearchResult = {
      name: 'Portishead',
      mbid: mbid1,
      images: [{ url: 'https://img.a/p.jpg', source: 'a' }],
      genres: ['trip-hop'],
      popularity: 80,
      sourceId: 'a',
      sourceUrl: 'https://a.com/portishead',
    }
    const r2: SearchResult = {
      name: 'Portishead',
      mbid: mbid1,
      images: [{ url: 'https://img.b/p.jpg', source: 'b' }],
      genres: ['downtempo'],
      sourceId: 'b',
      sourceUrl: 'https://b.com/portishead',
    }
    const src1 = makeSource('a', [r1])
    const src2 = makeSource('b', [r2])

    const results = await multiSourceSearch('portishead', [src1, src2])

    expect(results).toHaveLength(1)
    expect(results[0]?.name).toBe('Portishead')
    expect(results[0]?.mbid).toBe(mbid1)
    expect(results[0]?.sources).toHaveLength(2)
    // Images from both sources should be merged
    expect(results[0]?.images).toHaveLength(2)
    // Genres should be merged (deduped)
    expect(results[0]?.genres).toContain('trip-hop')
    expect(results[0]?.genres).toContain('downtempo')
    expect(src1.search).toHaveBeenCalledWith('portishead', expect.any(Number))
    expect(src2.search).toHaveBeenCalledWith('portishead', expect.any(Number))
  })

  it('deduplicates by lowercase name when MBID missing', async () => {
    const r1: SearchResult = {
      name: 'Massive Attack',
      images: [],
      genres: ['trip-hop'],
      sourceId: 'a',
    }
    const r2: SearchResult = {
      name: 'massive attack',
      images: [],
      genres: ['electronic'],
      sourceId: 'b',
    }
    const results = await multiSourceSearch('massive attack', [
      makeSource('a', [r1]),
      makeSource('b', [r2]),
    ])
    expect(results).toHaveLength(1)
    expect(results[0]?.sources).toHaveLength(2)
  })

  it('skips unavailable sources', async () => {
    const available = makeSource('a', [
      { name: 'Burial', images: [], genres: ['dubstep'], sourceId: 'a' },
    ])
    const unavailable = makeSource('b', [], false)

    const results = await multiSourceSearch('burial', [available, unavailable])
    expect(unavailable.search).not.toHaveBeenCalled()
    expect(results).toHaveLength(1)
  })

  it('marks inLibrary and inRecommendations from provided sets', async () => {
    const r1: SearchResult = {
      name: 'Grouper',
      mbid: mbid1,
      images: [],
      genres: ['ambient'],
      sourceId: 'a',
    }
    const r2: SearchResult = {
      name: 'Burial',
      mbid: mbid2,
      images: [],
      genres: ['dubstep'],
      sourceId: 'a',
    }
    const r3: SearchResult = {
      name: 'Unknown Artist',
      images: [],
      genres: [],
      sourceId: 'a',
    }

    const results = await multiSourceSearch('test', [makeSource('a', [r1, r2, r3])], {
      libraryMbids: new Set([mbid1]),
      recMbids: new Set([mbid2]),
    })

    const grouper = results.find((r) => r.name === 'Grouper')
    const burial = results.find((r) => r.name === 'Burial')
    const unknown = results.find((r) => r.name === 'Unknown Artist')

    expect(grouper?.inLibrary).toBe(true)
    expect(grouper?.inRecommendations).toBe(false)
    expect(burial?.inLibrary).toBe(false)
    expect(burial?.inRecommendations).toBe(true)
    expect(unknown?.inLibrary).toBe(false)
    expect(unknown?.inRecommendations).toBe(false)
  })

  it('handles source errors gracefully -- one fails, others succeed', async () => {
    const good = makeSource('a', [
      { name: 'Portishead', mbid: mbid1, images: [], genres: [], sourceId: 'a' },
    ])
    const bad: SearchSource = {
      id: 'bad',
      name: 'bad',
      available: true,
      search: vi.fn().mockRejectedValue(new Error('network error')),
    }

    const results = await multiSourceSearch('portishead', [good, bad])
    expect(results).toHaveLength(1)
    expect(results[0]?.name).toBe('Portishead')
  })

  it('sorts by source count descending', async () => {
    const r1: SearchResult = {
      name: 'Artist A',
      mbid: mbid1,
      images: [],
      genres: [],
      sourceId: 'a',
    }
    const r2: SearchResult = {
      name: 'Artist B',
      mbid: mbid2,
      images: [],
      genres: [],
      sourceId: 'a',
    }
    const r3: SearchResult = {
      name: 'Artist A',
      mbid: mbid1,
      images: [],
      genres: [],
      sourceId: 'b',
    }

    const results = await multiSourceSearch('test', [
      makeSource('a', [r1, r2]),
      makeSource('b', [r3]),
    ])
    // Artist A appears in 2 sources, Artist B in 1 -- A should come first
    expect(results[0]?.name).toBe('Artist A')
    expect(results[1]?.name).toBe('Artist B')
  })

  it('keeps the most probable exact match ahead of noisier multi-source matches', async () => {
    const exact: SearchResult = {
      name: 'Scorpions',
      mbid: mbid1,
      images: [],
      genres: ['rock'],
      sourceId: 'musicbrainz',
    }
    const noisyA: SearchResult = {
      name: 'Scorpions Tribute Band',
      mbid: mbid2,
      images: [{ url: 'https://img.example/noisy.jpg', source: 'deezer' }],
      genres: ['rock'],
      listeners: 500_000,
      sourceId: 'deezer',
    }
    const noisyB: SearchResult = {
      name: 'Scorpions Tribute Band',
      mbid: mbid2,
      images: [],
      genres: ['hard rock'],
      sourceId: 'bandcamp',
    }

    const results = await multiSourceSearch('scorpions', [
      makeSource('musicbrainz', [exact]),
      makeSource('deezer', [noisyA]),
      makeSource('bandcamp', [noisyB]),
    ])

    expect(results[0]?.name).toBe('Scorpions')
    expect(results[1]?.name).toBe('Scorpions Tribute Band')
    expect(results[1]?.sources).toHaveLength(2)
  })

  it('respects limit', async () => {
    const manyResults: SearchResult[] = Array.from({ length: 30 }, (_, i) => ({
      name: `Artist ${i}`,
      images: [],
      genres: [],
      sourceId: 'a',
    }))
    const results = await multiSourceSearch('test', [makeSource('a', manyResults)], { limit: 10 })
    expect(results.length).toBeLessThanOrEqual(10)
  })

  it('returns empty array when no sources are available', async () => {
    const results = await multiSourceSearch('test', [makeSource('a', [], false)])
    expect(results).toEqual([])
  })

  it('returns empty array when sources return no results', async () => {
    const results = await multiSourceSearch('zzznomatch', [makeSource('a', [])])
    expect(results).toEqual([])
  })
})
