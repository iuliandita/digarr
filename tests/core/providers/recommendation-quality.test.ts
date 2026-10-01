// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { AiRecommendation } from '@/core/types'
import assertRecommendations from '../../../scripts/evals/assert-recommendations'
import {
  evaluateRecommendationOutput,
  MAX_RECOMMENDATION_OUTPUT_LENGTH,
  RecommendationQualityFixtureSchema,
  recommendationQualityFixtures,
} from '../../../scripts/evals/recommendation-quality'

function getFixture(id: string) {
  const found = recommendationQualityFixtures.find((fixture) => fixture.id === id)
  if (!found) throw new Error(`Missing test fixture: ${id}`)
  return found
}

const fixture = getFixture('art-rock')
const coldStart = getFixture('cold-start')

function recommendation(index: number): AiRecommendation {
  return {
    artistName: index === 0 ? 'Portishead' : `Synthetic artist ${index}`,
    reasoning: 'A distinct sound with a plausible relationship to the listening profile.',
    confidence: 0.8,
    genres: ['art rock'],
  }
}

function recommendations(): AiRecommendation[] {
  return Array.from({ length: 15 }, (_, index) => recommendation(index))
}

function evaluate(rows: unknown[]) {
  return evaluateRecommendationOutput(JSON.stringify(rows), fixture)
}

describe('recommendation quality assertions', () => {
  it('accepts a complete distinct batch and keeps subjective judgments separate', () => {
    const result = evaluate(recommendations())
    expect(result.pass).toBe(true)
    expect(result.metrics).toEqual({
      returnedCount: 15,
      validCount: 15,
      duplicateCount: 0,
      seedLeakCount: 0,
      neighborHitCount: 1,
      neighborCheck: 'passed',
    })
    expect(result.judgments).toEqual({
      recommendationFit: 'unjudged',
      previewAvailability: 'unmeasured',
      delivery: 'unmeasured',
    })
  })

  it.each([
    { confidence: 1.1 },
    { confidence: '0.8' },
    { genres: 'art rock' },
    { suggestedAlbum: 42 },
    { reasoning: 'x'.repeat(2001) },
    { artistName: 'x'.repeat(201) },
  ])('fails malformed rows even when production parsing drops them: %j', (invalidFields) => {
    const rows = recommendations()
    const result = evaluate([...rows, { ...recommendation(1), ...invalidFields }])
    expect(result.pass).toBe(false)
    expect(result.metrics.returnedCount).toBe(16)
    expect(result.metrics.validCount).toBe(15)
    expect(result.issues.join(' ')).toContain('production item schema')
  })

  it.each([0, 14, 21, 51])('rejects batches with %i rows', (count) => {
    const rows = Array.from({ length: count }, (_, index) => ({
      ...recommendation(0),
      artistName: index ? `Artist ${index}` : 'Portishead',
    }))
    expect(evaluate(rows).pass).toBe(false)
  })

  it('detects case, compatibility Unicode and whitespace duplicates', () => {
    const rows = recommendations()
    rows[1] = { ...recommendation(1), artistName: '  ＰＯＲＴＩＳＨＥＡＤ  ' }
    rows[2] = { ...recommendation(2), artistName: 'Synthetic\t artist 3' }
    const result = evaluate(rows)
    expect(result.pass).toBe(false)
    expect(result.metrics.duplicateCount).toBe(2)
    expect(result.metrics.neighborHitCount).toBe(1)
  })

  it('preserves accents and punctuation when comparing names', () => {
    const rows = recommendations()
    rows[1] = { ...recommendation(1), artistName: 'Beyoncé' }
    rows[2] = { ...recommendation(2), artistName: 'Beyonce' }
    rows[3] = { ...recommendation(3), artistName: 'AC/DC' }
    rows[4] = { ...recommendation(4), artistName: 'ACDC' }
    expect(evaluate(rows).metrics.duplicateCount).toBe(0)
  })

  it('rejects seeds and fixture-specific exclusions', () => {
    const rows = recommendations()
    rows[1] = { ...recommendation(1), artistName: '  RADIOHEAD ' }
    rows[2] = { ...recommendation(2), artistName: 'Excluded artist' }
    const result = evaluateRecommendationOutput(JSON.stringify(rows), {
      ...fixture,
      excludedArtists: ['Excluded artist'],
    })
    expect(result.pass).toBe(false)
    expect(result.metrics.seedLeakCount).toBe(2)
  })

  it('does not count expected neighbors mentioned only in reasoning', () => {
    const rows = recommendations()
    rows[0] = {
      ...recommendation(0),
      artistName: 'Different artist',
      reasoning: 'Similar to Portishead.',
    }
    const result = evaluate(rows)
    expect(result.pass).toBe(false)
    expect(result.metrics.neighborHitCount).toBe(0)
    expect(result.metrics.neighborCheck).toBe('failed')
  })

  it('scores only the recommendations field in wrappers with earlier arrays', () => {
    const rows = recommendations()
    rows[0] = { ...recommendation(0), artistName: 'Different artist' }
    const output = JSON.stringify({ notes: recommendations(), recommendations: rows })
    const result = evaluateRecommendationOutput(output, fixture)
    expect(result.pass).toBe(false)
    expect(result.metrics.neighborHitCount).toBe(0)
    expect(result.metrics.validCount).toBe(15)
  })

  it.each(['array', 'wrapper', 'fenced-array', 'fenced-wrapper', 'reasoning-block'])(
    'accepts production %s payloads',
    (format) => {
      const raw = JSON.stringify(
        format.includes('wrapper') ? { recommendations: recommendations() } : recommendations(),
      )
      const output = format.startsWith('fenced')
        ? `\`\`\`json\n${raw}\n\`\`\``
        : format === 'reasoning-block'
          ? `<think>Ignore internal [draft] notes.</think>${raw}`
          : raw
      expect(evaluateRecommendationOutput(output, fixture).pass).toBe(true)
    },
  )

  it.each([
    'not JSON',
    'null',
    '{}',
    '{"other":[]}',
    '[',
    '{"recommendations":[]',
    '[{"confidence":NaN}]',
  ])('fails invalid or unknown payload %s without crashing', (output) => {
    expect(evaluateRecommendationOutput(output, fixture).pass).toBe(false)
  })

  it('rejects oversized output before parsing', () => {
    expect(
      evaluateRecommendationOutput(
        ' '.repeat(MAX_RECOMMENDATION_OUTPUT_LENGTH + 1),
        fixture,
      ).issues.join(' '),
    ).toContain('limit')
  })

  it('requires a complete cold-start batch without assuming neighbor ground truth', () => {
    expect(evaluateRecommendationOutput('[]', coldStart).pass).toBe(false)
    const result = evaluateRecommendationOutput(JSON.stringify(recommendations()), coldStart)
    expect(result.pass).toBe(true)
    expect(result.metrics.neighborCheck).toBe('not_applicable')
  })

  it('rejects whitespace-only artist names', () => {
    const rows = recommendations()
    rows[1] = { ...recommendation(1), artistName: '   ' }
    expect(evaluate(rows).pass).toBe(false)
  })

  it('rejects unsupported fixture cohorts, locale values and raw prompt overrides', () => {
    expect(
      RecommendationQualityFixtureSchema.safeParse({ ...fixture, cohort: 'unknown' }).success,
    ).toBe(false)
    expect(
      RecommendationQualityFixtureSchema.safeParse({
        ...fixture,
        profile: { ...fixture.profile, responseLocale: 'unknown' },
      }).success,
    ).toBe(false)
    expect(
      RecommendationQualityFixtureSchema.safeParse({
        ...fixture,
        profile: { ...fixture.profile, _rawPrompt: 'override' },
      }).success,
    ).toBe(false)
  })

  it('returns a failing assertion for an unknown fixture ID', () => {
    expect(
      assertRecommendations(JSON.stringify(recommendations()), { vars: { caseId: 'unknown' } }),
    ).toEqual({
      pass: false,
      score: 0,
      reason: 'Unknown recommendation quality fixture ID',
    })
    expect(
      assertRecommendations(JSON.stringify(recommendations()), { vars: { caseId: fixture.id } })
        .score,
    ).toBe(1)
  })
})
