import { describe, expect, it } from 'vitest'
import { applyAlbumModifier } from '@/core/pipeline/score'

describe('applyAlbumModifier', () => {
  it('boosts a recent, popular gap-fill album and clamps to [0,1]', () => {
    const out = applyAlbumModifier(0.7, { recency: 1, popularity: 1, gapPriority: 1 })
    expect(out).toBeGreaterThan(0.7)
    expect(out).toBeLessThanOrEqual(1)
  })
  it('returns the base score (clamped) when no signals are present', () => {
    expect(applyAlbumModifier(0.5, {})).toBe(0.5)
  })
  it('lowers the score when signals are all weak (below midpoint)', () => {
    expect(applyAlbumModifier(0.5, { recency: 0, popularity: 0, gapPriority: 0 })).toBeLessThan(0.5)
  })
  it('never drops below 0', () => {
    expect(
      applyAlbumModifier(0.01, { recency: 0, popularity: 0, gapPriority: 0 }),
    ).toBeGreaterThanOrEqual(0)
  })
  it('never exceeds 1', () => {
    expect(
      applyAlbumModifier(0.99, { recency: 1, popularity: 1, gapPriority: 1 }),
    ).toBeLessThanOrEqual(1)
  })
})
