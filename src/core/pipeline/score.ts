import type { ResolvedArtist, ScoredArtist } from '@/core/types'
import type { Preferences, ScoringWeights } from '@/db/schema'

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

export function score(
  artists: ResolvedArtist[],
  libraryGenres: string[],
  weights: Preferences['scoringWeights'],
  feedbackHistory: Map<string, { approved: number; total: number }>,
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

    // Feedback boost: per-genre approve rate, default 0.5 if no history
    const genreRates = artistGenres.map((genre) => {
      const history = feedbackHistory.get(genre)
      if (history === undefined || history.total === 0) return 0.5
      return history.approved / history.total
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
