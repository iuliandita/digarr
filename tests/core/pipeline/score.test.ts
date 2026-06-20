// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { score } from '@/core/pipeline/score'
import type { ResolvedArtist } from '@/core/types'
import type { Preferences } from '@/db/schema'

const defaultWeights: Preferences['scoringWeights'] = {
  consensus: 0.3,
  similarity: 0.25,
  genreOverlap: 0.2,
  aiConfidence: 0.15,
  feedbackBoost: 0.1,
  popularity: 0.0,
}

function makeArtist(overrides: Partial<ResolvedArtist> = {}): ResolvedArtist {
  return {
    mbid: 'mbid-test',
    name: 'Test Artist',
    tags: ['rock'],
    genres: ['rock'],
    streamingUrls: {},
    discoveries: [{ name: 'Test Artist', similarityScore: 0.8, source: 'listenbrainz' }],
    ...overrides,
  }
}

describe('score()', () => {
  it('returns sorted array descending by score', () => {
    const artists = [
      makeArtist({
        mbid: 'mbid-a',
        name: 'Artist A',
        genres: [],
        discoveries: [{ name: 'Artist A', similarityScore: 0.9, source: 'listenbrainz' }],
      }),
      makeArtist({
        mbid: 'mbid-b',
        name: 'Artist B',
        genres: ['rock'],
        discoveries: [
          { name: 'Artist B', similarityScore: 0.9, source: 'listenbrainz' },
          { name: 'Artist B', similarityScore: 0.9, source: 'lastfm' },
          { name: 'Artist B', similarityScore: 0.9, source: 'musicbrainz' },
          { name: 'Artist B', similarityScore: 0.9, source: 'ai' },
        ],
      }),
    ]

    const result = score(artists, ['rock'], defaultWeights, new Map())

    // Artist B has more sources -> higher consensus -> should be first
    expect(result[0]?.mbid).toBe('mbid-b')
    expect(result[1]?.mbid).toBe('mbid-a')
    expect(result[0]?.score).toBeGreaterThanOrEqual(result[1]?.score ?? 0)
  })

  it('computes consensus as unique source count / 4, capped at 1.0', () => {
    const artist4sources = makeArtist({
      discoveries: [
        { name: 'X', similarityScore: 0.5, source: 'listenbrainz' },
        { name: 'X', similarityScore: 0.5, source: 'lastfm' },
        { name: 'X', similarityScore: 0.5, source: 'musicbrainz' },
        { name: 'X', similarityScore: 0.5, source: 'ai' },
      ],
    })
    const result = score([artist4sources], [], defaultWeights, new Map())
    expect(result[0]?.sourceScores.consensus).toBe(1.0)
  })

  it('uses 0.5 default for aiConfidence when no AI discovery exists', () => {
    const artist = makeArtist({
      discoveries: [{ name: 'X', similarityScore: 0.6, source: 'listenbrainz' }],
    })
    const result = score([artist], [], defaultWeights, new Map())
    expect(result[0]?.sourceScores.aiConfidence).toBe(0.5)
  })

  it('uses actual AI similarityScore for aiConfidence when AI discovery exists', () => {
    const artist = makeArtist({
      discoveries: [{ name: 'X', similarityScore: 0.9, source: 'ai' }],
    })
    const result = score([artist], [], defaultWeights, new Map())
    expect(result[0]?.sourceScores.aiConfidence).toBe(0.9)
  })

  it('uses 0.5 default feedbackBoost when no feedback history', () => {
    const artist = makeArtist({ genres: ['jazz'] })
    const result = score([artist], [], defaultWeights, new Map())
    expect(result[0]?.sourceScores.feedbackBoost).toBe(0.5)
  })

  it('computes feedbackBoost from genre approve rates', () => {
    const artist = makeArtist({ genres: ['jazz', 'blues'] })
    const feedback = new Map([
      ['jazz', { approved: 8, total: 10 }], // 0.8
      ['blues', { approved: 4, total: 10 }], // 0.4
    ])
    const result = score([artist], [], defaultWeights, feedback)
    // Average: (0.8 + 0.4) / 2 = 0.6
    expect(result[0]?.sourceScores.feedbackBoost).toBeCloseTo(0.6)
  })

  it('feedbackBoost is unchanged when a genre has zero strong-negative rejections (parity)', () => {
    const artist = makeArtist({ genres: ['jazz'] })
    const withoutField = new Map([['jazz', { approved: 6, total: 10 }]])
    const withZeroField = new Map([['jazz', { approved: 6, total: 10, strongNegative: 0 }]])
    const a = score([artist], [], defaultWeights, withoutField)
    const b = score([artist], [], defaultWeights, withZeroField)
    // Both equal the plain approve rate, 0.6.
    expect(a[0]?.sourceScores.feedbackBoost).toBeCloseTo(0.6)
    expect(b[0]?.sourceScores.feedbackBoost).toBeCloseTo(0.6)
  })

  it('downweights a genre with strong-negative rejections below an all-neutral genre', () => {
    const artist = makeArtist({ genres: ['jazz'] })
    // Same 0.5 approve rate, but half of the acted-on recs were strong-negative.
    const neutral = score(
      [artist],
      [],
      defaultWeights,
      new Map([['jazz', { approved: 5, total: 10, strongNegative: 0 }]]),
    )
    const disliked = score(
      [artist],
      [],
      defaultWeights,
      new Map([['jazz', { approved: 5, total: 10, strongNegative: 5 }]]),
    )
    expect(neutral[0]?.sourceScores.feedbackBoost).toBeCloseTo(0.5)
    expect(disliked[0]?.sourceScores.feedbackBoost).toBeLessThan(0.5)
  })

  it('clamps feedbackBoost at 0 even when strong-negative penalty would push it lower', () => {
    const artist = makeArtist({ genres: ['jazz'] })
    // Every acted-on rec was a strong-negative rejection: approve rate 0, penalty applied.
    const result = score(
      [artist],
      [],
      defaultWeights,
      new Map([['jazz', { approved: 0, total: 8, strongNegative: 8 }]]),
    )
    expect(result[0]?.sourceScores.feedbackBoost).toBe(0)
  })

  it('computes genreOverlap correctly', () => {
    const artist = makeArtist({ genres: ['rock', 'metal', 'jazz'] })
    const libraryGenres = ['rock', 'jazz']
    const result = score([artist], libraryGenres, defaultWeights, new Map())
    // 2 out of 3 genres overlap
    expect(result[0]?.sourceScores.genreOverlap).toBeCloseTo(2 / 3)
  })

  it('genreOverlap is 0 when artist has no genres', () => {
    const artist = makeArtist({ genres: [] })
    const result = score([artist], ['rock'], defaultWeights, new Map())
    expect(result[0]?.sourceScores.genreOverlap).toBe(0)
  })

  it('respects configurable weights', () => {
    const heavyConsensus: Preferences['scoringWeights'] = {
      consensus: 1.0,
      similarity: 0,
      genreOverlap: 0,
      aiConfidence: 0,
      feedbackBoost: 0,
      popularity: 0,
    }

    const artist1source = makeArtist({
      mbid: 'mbid-1',
      discoveries: [{ name: 'X', similarityScore: 0.5, source: 'listenbrainz' }],
    })
    const artist4sources = makeArtist({
      mbid: 'mbid-4',
      discoveries: [
        { name: 'X', similarityScore: 0.5, source: 'listenbrainz' },
        { name: 'X', similarityScore: 0.5, source: 'lastfm' },
        { name: 'X', similarityScore: 0.5, source: 'musicbrainz' },
        { name: 'X', similarityScore: 0.5, source: 'ai' },
      ],
    })

    const result = score([artist1source, artist4sources], [], heavyConsensus, new Map())
    // With consensus weight = 1.0, 4-source artist should score much higher
    expect(result[0]?.mbid).toBe('mbid-4')
    expect(result[0]?.score).toBeGreaterThan(result[1]?.score ?? 0)
  })

  it('computes finalScore as weighted sum of all components', () => {
    const weights: Preferences['scoringWeights'] = {
      consensus: 0.3,
      similarity: 0.25,
      genreOverlap: 0.2,
      aiConfidence: 0.15,
      feedbackBoost: 0.1,
      popularity: 0.0,
    }
    // 2 sources -> consensus = 0.5
    // similarity = 0.8
    // genreOverlap = 1.0 (genre matches)
    // aiConfidence = 0.5 (no AI discovery)
    // feedbackBoost = 0.5 (no feedback)
    const artist = makeArtist({
      genres: ['rock'],
      discoveries: [
        { name: 'X', similarityScore: 0.8, source: 'listenbrainz' },
        { name: 'X', similarityScore: 0.8, source: 'lastfm' },
      ],
    })

    const result = score([artist], ['rock'], weights, new Map())
    const expected =
      0.3 * 0.5 + // consensus
      0.25 * 0.8 + // similarity
      0.2 * 1.0 + // genreOverlap
      0.15 * 0.5 + // aiConfidence (default)
      0.1 * 0.5 // feedbackBoost (default)

    expect(result[0]?.score).toBeCloseTo(expected)
  })

  it('handles empty artist list', () => {
    const result = score([], ['rock'], defaultWeights, new Map())
    expect(result).toEqual([])
  })

  it('popularity weight 0.0 does not change score', () => {
    const artist = makeArtist({ name: 'Popular Artist' })
    const popMap = new Map([['popular artist', 0.95]])
    const withPop = score([artist], ['rock'], defaultWeights, new Map(), popMap)
    const withoutPop = score([artist], ['rock'], defaultWeights, new Map())
    // popularity weight is 0.0, so score should be identical
    expect(withPop[0]?.score).toBeCloseTo(withoutPop[0]?.score ?? 0)
  })

  it('popularity weight > 0 increases score for popular artists', () => {
    const popWeights: Preferences['scoringWeights'] = {
      consensus: 0.2,
      similarity: 0.2,
      genreOverlap: 0.2,
      aiConfidence: 0.1,
      feedbackBoost: 0.1,
      popularity: 0.2,
    }
    const artist = makeArtist({ name: 'Popular Artist' })
    const popMap = new Map([['popular artist', 0.9]])
    const withPop = score([artist], ['rock'], popWeights, new Map(), popMap)
    const withoutPop = score([artist], ['rock'], popWeights, new Map())
    // With popularity map, score should be higher
    expect(withPop[0]?.score).toBeGreaterThan(withoutPop[0]?.score ?? 0)
    expect(withPop[0]?.sourceScores.popularity).toBeCloseTo(0.9)
  })

  it('artist not in popularity map gets popularity 0', () => {
    const popWeights: Preferences['scoringWeights'] = {
      ...defaultWeights,
      popularity: 0.2,
    }
    const artist = makeArtist({ name: 'Unknown Artist' })
    const popMap = new Map([['other artist', 0.8]])
    const result = score([artist], ['rock'], popWeights, new Map(), popMap)
    expect(result[0]?.sourceScores.popularity).toBe(0)
  })
})
