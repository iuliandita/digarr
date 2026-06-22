import { describe, expect, it } from 'vitest'
import { applyAlbumModifier, computeRecency } from '@/core/pipeline/score'

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

describe('computeRecency', () => {
  const now = new Date('2026-06-22T00:00:00Z')
  it('scores a brand-new release near 1', () => {
    expect(computeRecency('2026-06-01', now)).toBeGreaterThan(0.9)
  })
  it('scores a release just over two years old at 0', () => {
    expect(computeRecency('2024-01-01', now)).toBe(0)
  })
  it('returns a neutral 0.5 for an unparseable date', () => {
    expect(computeRecency('not-a-date', now)).toBe(0.5)
  })
  it('clamps a future release to 1', () => {
    expect(computeRecency('2027-01-01', now)).toBe(1)
  })
})
