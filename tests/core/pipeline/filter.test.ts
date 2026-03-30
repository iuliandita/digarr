// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { filter } from '@/core/pipeline/filter'
import type { ScoredArtist } from '@/core/types'

function makeArtist(mbid: string, score = 0.7): ScoredArtist {
  return {
    mbid,
    name: `Artist ${mbid}`,
    tags: [],
    genres: [],
    streamingUrls: {},
    discoveries: [],
    score,
    sourceScores: {
      consensus: 0.5,
      similarity: 0.5,
      genreOverlap: 0.5,
      aiConfidence: 0.5,
      feedbackBoost: 0.5,
    },
  }
}

describe('filter()', () => {
  it('removes artists already in library', () => {
    const artists = [makeArtist('mbid-owned'), makeArtist('mbid-new')]
    const libraryMbids = new Set(['mbid-owned'])

    const result = filter(artists, libraryMbids, new Map(), 90, 0.5)

    expect(result.map((a) => a.mbid)).toEqual(['mbid-new'])
  })

  it('removes rejected artists within cooldown period', () => {
    const artists = [makeArtist('mbid-rejected'), makeArtist('mbid-new')]
    const rejectedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) // 10 days ago
    const rejected = new Map([['mbid-rejected', rejectedAt]])

    // 90-day cooldown, 10 days elapsed -> still in cooldown
    const result = filter(artists, new Set(), rejected, 90, 0.5)

    expect(result.map((a) => a.mbid)).toEqual(['mbid-new'])
  })

  it('keeps rejected artists after cooldown expires', () => {
    const artists = [makeArtist('mbid-old-reject')]
    const rejectedAt = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000) // 100 days ago
    const rejected = new Map([['mbid-old-reject', rejectedAt]])

    // 90-day cooldown, 100 days elapsed -> cooldown expired
    const result = filter(artists, new Set(), rejected, 90, 0.5)

    expect(result).toHaveLength(1)
    expect(result[0]?.mbid).toBe('mbid-old-reject')
  })

  it('removes artists below score threshold', () => {
    const artists = [makeArtist('mbid-low', 0.3), makeArtist('mbid-high', 0.8)]

    const result = filter(artists, new Set(), new Map(), 90, 0.5)

    expect(result.map((a) => a.mbid)).toEqual(['mbid-high'])
  })

  it('keeps artists at exactly the score threshold', () => {
    const artists = [makeArtist('mbid-exact', 0.5)]

    const result = filter(artists, new Set(), new Map(), 90, 0.5)

    expect(result).toHaveLength(1)
  })

  it('keeps valid artists that pass all filters', () => {
    const artists = [makeArtist('mbid-valid-1', 0.8), makeArtist('mbid-valid-2', 0.9)]

    const result = filter(artists, new Set(), new Map(), 90, 0.5)

    expect(result).toHaveLength(2)
  })

  it('applies all filters simultaneously', () => {
    const artists = [
      makeArtist('mbid-owned', 0.9), // removed: in library
      makeArtist('mbid-rejected', 0.9), // removed: in cooldown
      makeArtist('mbid-low-score', 0.2), // removed: below threshold
      makeArtist('mbid-valid', 0.8), // kept
    ]
    const libraryMbids = new Set(['mbid-owned'])
    const rejected = new Map([['mbid-rejected', new Date()]])

    const result = filter(artists, libraryMbids, rejected, 90, 0.5)

    expect(result).toHaveLength(1)
    expect(result[0]?.mbid).toBe('mbid-valid')
  })

  it('returns empty array when all artists are filtered', () => {
    const artists = [makeArtist('mbid-owned', 0.9)]
    const result = filter(artists, new Set(['mbid-owned']), new Map(), 90, 0.5)
    expect(result).toEqual([])
  })

  it('returns all artists when list is empty', () => {
    const result = filter([], new Set(), new Map(), 90, 0.5)
    expect(result).toEqual([])
  })

  describe('top artist name exclusion', () => {
    it('removes artists whose name matches a top listened artist', () => {
      const artist = makeArtist('mbid-vu', 0.8)
      artist.name = 'The Velvet Underground'
      const topNames = new Set(['the velvet underground'])

      const result = filter([artist], new Set(), new Map(), 90, 0.5, topNames)

      expect(result).toHaveLength(0)
    })

    it('name check is case-insensitive (resolved name has different casing)', () => {
      const artist = makeArtist('mbid-sy', 0.8)
      artist.name = 'Sonic Youth'
      const topNames = new Set(['sonic youth'])

      const result = filter([artist], new Set(), new Map(), 90, 0.5, topNames)

      expect(result).toHaveLength(0)
    })

    it('does not exclude when topArtistNames is not provided', () => {
      const artist = makeArtist('mbid-vu', 0.8)
      artist.name = 'The Velvet Underground'

      const result = filter([artist], new Set(), new Map(), 90, 0.5)

      expect(result).toHaveLength(1)
    })

    it('does not exclude artists with different names', () => {
      const artist = makeArtist('mbid-du', 0.8)
      artist.name = 'Digital Underground'
      const topNames = new Set(['the velvet underground'])

      const result = filter([artist], new Set(), new Map(), 90, 0.5, topNames)

      expect(result).toHaveLength(1)
    })
  })
})
