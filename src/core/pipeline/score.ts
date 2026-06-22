import type { ResolvedArtist, ScoredArtist } from '@/core/types'
import type { Preferences, ScoringWeights } from '@/db/schema'

/** Per-genre feedback tally feeding the feedbackBoost score component. */
export type GenreFeedback = {
  approved: number
  total: number
  /**
   * Count of acted-on recommendations rejected with a strong-negative reason
   * (`tried_didnt_like` / `wrong_style`). Optional for backward compatibility;
   * absent is treated as 0, leaving the score identical to the approve-rate-only
   * behaviour.
   */
  strongNegative?: number
}

/**
 * How hard a fully strong-negative genre is downweighted. The penalty scales
 * with the fraction of acted-on recs that were strong-negative rejections, so a
 * genre the user actively disliked drops below an equivalent neutral genre
 * without destabilising the curve. Kept conservative pending real rejection data.
 */
const STRONG_NEGATIVE_PENALTY = 0.5

/** Compute a weighted composite score, clamped to [0, 1]. */
export function computeWeightedScore(
  weights: ScoringWeights,
  components: {
    consensus: number
    similarity: number
    genreOverlap: number
    aiConfidence: number
    feedbackBoost: number
    popularity: number
  },
): number {
  const raw =
    weights.consensus * components.consensus +
    weights.similarity * components.similarity +
    weights.genreOverlap * components.genreOverlap +
    weights.aiConfidence * components.aiConfidence +
    weights.feedbackBoost * components.feedbackBoost +
    (weights.popularity ?? 0) * components.popularity
  return Math.max(0, Math.min(1, raw))
}

/** Album signals carried in the recommendation `sources` jsonb (each 0..1). */
export type AlbumScoreSignals = {
  /** Newer release -> closer to 1 (release-radar). */
  recency?: number
  /** Album popularity / rating -> closer to 1. */
  popularity?: number
  /** Gap-fill priority (how core the missing album is) -> closer to 1. */
  gapPriority?: number
}

/** Max total nudge an album can receive on top of its artist base score. */
const ALBUM_MODIFIER_WEIGHT = 0.15

/**
 * Album score = artist base score + a bounded modifier from album signals.
 * Conservative by design: the artist-similarity base stays dominant; the
 * modifier only re-ranks albums within a similar-artist band. Clamped to [0, 1].
 */
export function applyAlbumModifier(baseScore: number, signals: AlbumScoreSignals): number {
  const present = [signals.recency, signals.popularity, signals.gapPriority].filter(
    (v): v is number => typeof v === 'number',
  )
  if (present.length === 0) return Math.max(0, Math.min(1, baseScore))
  const avg = present.reduce((sum, v) => sum + v, 0) / present.length
  const nudge = ALBUM_MODIFIER_WEIGHT * (avg - 0.5) * 2 // map 0..1 -> -weight..+weight
  return Math.max(0, Math.min(1, baseScore + nudge))
}

export function score(
  artists: ResolvedArtist[],
  libraryGenres: string[],
  weights: Preferences['scoringWeights'],
  feedbackHistory: Map<string, GenreFeedback>,
  popularityMap?: Map<string, number>,
): ScoredArtist[] {
  const libraryGenreSet = new Set(libraryGenres.map((g) => g.toLowerCase()))

  const scored = artists.map((artist): ScoredArtist => {
    // How many distinct sources found this artist (capped at 1.0, max 4 sources)
    const uniqueSources = new Set(artist.discoveries.map((d) => d.source))
    const consensus = Math.min(uniqueSources.size / 4, 1.0)

    // Average similarity score across all discoveries
    const similarity =
      artist.discoveries.length > 0
        ? artist.discoveries.reduce((sum, d) => sum + d.similarityScore, 0) /
          artist.discoveries.length
        : 0

    // Fraction of this artist's genres that overlap with library genres
    const artistGenres = artist.genres.map((g) => g.toLowerCase())
    const genreOverlap =
      artistGenres.length > 0
        ? artistGenres.filter((g) => libraryGenreSet.has(g)).length / artistGenres.length
        : 0

    // AI confidence: average confidence from AI discoveries, default 0.5 if none
    const aiDiscoveries = artist.discoveries.filter((d) => d.source === 'ai')
    const aiConfidence =
      aiDiscoveries.length > 0
        ? aiDiscoveries.reduce((sum, d) => sum + d.similarityScore, 0) / aiDiscoveries.length
        : 0.5

    // Feedback boost: per-genre approve rate, default 0.5 if no history.
    // Strong-negative rejections (tried_didnt_like / wrong_style) apply an extra
    // conservative penalty on top of the lower approve rate, so a genre the user
    // actively disliked is downweighted further. With no strong-negative history
    // this is exactly the approve rate (parity with the prior behaviour).
    const genreRates = artistGenres.map((genre) => {
      const history = feedbackHistory.get(genre)
      if (history === undefined || history.total === 0) return 0.5
      const base = history.approved / history.total
      const strongNegativeFraction = (history.strongNegative ?? 0) / history.total
      const penalty = STRONG_NEGATIVE_PENALTY * strongNegativeFraction
      return Math.max(0, base * (1 - penalty))
    })
    const feedbackBoost =
      genreRates.length > 0 ? genreRates.reduce((a, b) => a + b, 0) / genreRates.length : 0.5

    // Popularity: normalized 0-1 from artist_metadata, 0 if not found
    const popularity = popularityMap?.get(artist.name.trim().toLowerCase()) ?? 0

    // Weighted composite score (clamped to [0, 1])
    const finalScore = computeWeightedScore(weights, {
      consensus,
      similarity,
      genreOverlap,
      aiConfidence,
      feedbackBoost,
      popularity,
    })

    // AI reasoning from first AI discovery
    const aiDiscovery = artist.discoveries.find((d) => d.source === 'ai')

    return {
      ...artist,
      score: finalScore,
      sourceScores: {
        consensus,
        similarity,
        genreOverlap,
        aiConfidence,
        feedbackBoost,
        popularity,
      },
      aiReasoning: aiDiscovery?.aiReasoning,
    }
  })

  return scored.sort((a, b) => b.score - a.score)
}
