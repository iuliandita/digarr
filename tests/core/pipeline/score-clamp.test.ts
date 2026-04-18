import { describe, expect, it } from 'vitest'
import { computeWeightedScore } from '@/core/pipeline/score'
import type { ScoringWeights } from '@/db/schema'

const allOnes = {
  consensus: 1,
  similarity: 1,
  genreOverlap: 1,
  aiConfidence: 1,
  feedbackBoost: 1,
  popularity: 1,
}

describe('computeWeightedScore clamp', () => {
  it('clamps result to [0, 1] when weights sum to >1', () => {
    const weights: ScoringWeights = {
      consensus: 5,
      similarity: 5,
      genreOverlap: 5,
      aiConfidence: 5,
      feedbackBoost: 5,
      popularity: 5,
    }
    const score = computeWeightedScore(weights, allOnes)
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(1)
    expect(score).toBe(1)
  })

  it('clamps negative result to 0', () => {
    const weights: ScoringWeights = {
      consensus: -2,
      similarity: -2,
      genreOverlap: -2,
      aiConfidence: -2,
      feedbackBoost: -2,
      popularity: -2,
    }
    const score = computeWeightedScore(weights, allOnes)
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBe(0)
  })

  it('returns 0 when all components are 0', () => {
    const weights: ScoringWeights = {
      consensus: 0.5,
      similarity: 0.2,
      genreOverlap: 0.1,
      aiConfidence: 0.1,
      feedbackBoost: 0.05,
      popularity: 0.05,
    }
    const score = computeWeightedScore(weights, {
      consensus: 0,
      similarity: 0,
      genreOverlap: 0,
      aiConfidence: 0,
      feedbackBoost: 0,
      popularity: 0,
    })
    expect(score).toBe(0)
  })

  it('matches default-weights linear combination when within bounds', () => {
    const weights: ScoringWeights = {
      consensus: 0.3,
      similarity: 0.25,
      genreOverlap: 0.2,
      aiConfidence: 0.15,
      feedbackBoost: 0.1,
      popularity: 0,
    }
    const components = {
      consensus: 0.5,
      similarity: 0.8,
      genreOverlap: 0.4,
      aiConfidence: 0.6,
      feedbackBoost: 0.7,
      popularity: 1,
    }
    // 0.15 + 0.20 + 0.08 + 0.09 + 0.07 + 0 = 0.59
    expect(computeWeightedScore(weights, components)).toBeCloseTo(0.59, 5)
  })

  it('handles popularity weight defaulting to 0 when undefined', () => {
    const weights = {
      consensus: 0.3,
      similarity: 0.25,
      genreOverlap: 0.2,
      aiConfidence: 0.15,
      feedbackBoost: 0.1,
      // popularity intentionally omitted
    } as unknown as ScoringWeights
    const score = computeWeightedScore(weights, allOnes)
    // Sum without popularity contribution = 1.0 exactly
    expect(score).toBeCloseTo(1, 5)
  })
})
