import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES, mergePreferences, type Preferences } from '@/db/schema'

// DB rows may arrive with partial scoringWeights; tests intentionally pass
// shapes that don't match the strict type to simulate that real-world case.
const partialInput = (raw: unknown) => raw as Partial<Preferences>

describe('mergePreferences', () => {
  it('returns defaults when input is null', () => {
    expect(mergePreferences(null)).toEqual(DEFAULT_PREFERENCES)
  })

  it('returns defaults when input is undefined', () => {
    expect(mergePreferences(undefined)).toEqual(DEFAULT_PREFERENCES)
  })

  it('returns defaults when input is empty object', () => {
    expect(mergePreferences({})).toEqual(DEFAULT_PREFERENCES)
  })

  it('merges partial scoringWeights with defaults', () => {
    const merged = mergePreferences(partialInput({ scoringWeights: { consensus: 0.9 } }))
    expect(merged.scoringWeights.consensus).toBe(0.9)
    // Untouched weights fall back to defaults
    expect(merged.scoringWeights.similarity).toBe(DEFAULT_PREFERENCES.scoringWeights.similarity)
    expect(merged.scoringWeights.genreOverlap).toBe(DEFAULT_PREFERENCES.scoringWeights.genreOverlap)
    expect(merged.scoringWeights.aiConfidence).toBe(DEFAULT_PREFERENCES.scoringWeights.aiConfidence)
    expect(merged.scoringWeights.feedbackBoost).toBe(
      DEFAULT_PREFERENCES.scoringWeights.feedbackBoost,
    )
    expect(merged.scoringWeights.popularity).toBe(DEFAULT_PREFERENCES.scoringWeights.popularity)
  })

  it('fills missing rejectionCooldownDays (Invalid Date landmine)', () => {
    const merged = mergePreferences(partialInput({ scoringWeights: { consensus: 0.5 } }))
    expect(merged.rejectionCooldownDays).toBe(DEFAULT_PREFERENCES.rejectionCooldownDays)
    expect(typeof merged.rejectionCooldownDays).toBe('number')
    expect(Number.isFinite(merged.rejectionCooldownDays)).toBe(true)
  })

  it('preserves caller-provided rejectionCooldownDays', () => {
    const merged = mergePreferences({ rejectionCooldownDays: 7 })
    expect(merged.rejectionCooldownDays).toBe(7)
  })

  it('deep-merges scoringWeights without dropping user override', () => {
    const merged = mergePreferences(
      partialInput({
        scoringWeights: {
          consensus: 0.4,
          similarity: 0.3,
        },
        rejectionCooldownDays: 14,
      }),
    )
    expect(merged.scoringWeights.consensus).toBe(0.4)
    expect(merged.scoringWeights.similarity).toBe(0.3)
    expect(merged.rejectionCooldownDays).toBe(14)
    // Defaults still present for un-overridden fields
    expect(merged.scoringWeights.popularity).toBe(DEFAULT_PREFERENCES.scoringWeights.popularity)
    expect(merged.scheduleCron).toBe(DEFAULT_PREFERENCES.scheduleCron)
  })

  it('preserves top-level scalar overrides', () => {
    const merged = mergePreferences({
      qualityProfileId: 42,
      autoApproveEnabled: true,
      autoApproveThreshold: 0.95,
      scoreThreshold: 0.6,
    })
    expect(merged.qualityProfileId).toBe(42)
    expect(merged.autoApproveEnabled).toBe(true)
    expect(merged.autoApproveThreshold).toBe(0.95)
    expect(merged.scoreThreshold).toBe(0.6)
  })
})
