// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { resolveWeights, WEIGHT_PRESETS } from '@/core/pipeline/weight-presets'
import type { ScoringWeights } from '@/db/schema'

function sumWeights(w: ScoringWeights): number {
  return (
    w.consensus + w.similarity + w.genreOverlap + w.aiConfidence + w.feedbackBoost + w.popularity
  )
}

describe('WEIGHT_PRESETS', () => {
  it.each(['default', 'genre'] as const)('%s preset sums to 1.0', (name) => {
    expect(sumWeights(WEIGHT_PRESETS[name])).toBeCloseTo(1.0)
  })
})

describe('resolveWeights()', () => {
  it.each([
    ['default', undefined],
    ['genre', undefined],
    ['nonexistent', undefined],
    ['default', null],
  ])('resolves preset %s with overrides %s to the preset itself', (name, overrides) => {
    const expected = name === 'genre' ? WEIGHT_PRESETS.genre : WEIGHT_PRESETS.default
    expect(resolveWeights(name, overrides)).toEqual(expected)
  })

  it('applies an override to its key only and ignores unknown keys', () => {
    const result = resolveWeights('default', { consensus: 0.5, unknownKey: 0.99 })
    expect(result).toEqual({ ...WEIGHT_PRESETS.default, consensus: 0.5 })
  })
})
