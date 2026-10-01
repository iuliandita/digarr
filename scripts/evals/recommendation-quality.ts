import { z } from 'zod'
import { SUPPORTED_LOCALES } from '../../src/core/i18n/locales'
import {
  AiRecommendationItemSchema,
  parseRecommendationResponse,
  stripReasoningBlocks,
} from '../../src/core/providers/prompt'
import type { TasteProfile } from '../../src/core/types'
import fixtureData from '../../tests/fixtures/recommendation-quality.json'

const nameSchema = z.string().trim().min(1).max(200)
const profileSchema = z.strictObject({
  topArtists: z
    .array(
      z.strictObject({
        name: nameSchema,
        mbid: z.string().optional(),
        playCount: z.number().int().nonnegative(),
        source: z.string().min(1),
        genres: z.array(nameSchema).optional(),
        genreSource: z.enum(['native', 'library', 'artist-cache']).optional(),
      }),
    )
    .max(20),
  topGenres: z
    .array(z.strictObject({ name: nameSchema, weight: z.number().nonnegative() }))
    .max(10),
  genreCoverage: z
    .strictObject({
      coveredArtists: z.number().int().nonnegative(),
      pendingArtists: z.number().int().nonnegative(),
      totalArtists: z.number().int().nonnegative(),
    })
    .optional(),
  listeningPatterns: z.strictObject({
    totalListens: z.number().int().nonnegative(),
    recentTrend: z.enum(['increasing', 'stable', 'decreasing']),
  }),
  responseLocale: z.enum(SUPPORTED_LOCALES).optional(),
  promptLocale: z.enum(SUPPORTED_LOCALES).nullable().optional(),
}) satisfies z.ZodType<TasteProfile>

export const RecommendationQualityFixtureSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  cohort: z.enum(['established', 'cold-start', 'non-english', 'ambiguous-name', 'niche']),
  description: z.string().min(1).max(500),
  profile: profileSchema,
  expectedNeighbors: z.array(nameSchema).max(20),
  excludedArtists: z.array(nameSchema).max(50).optional(),
})

export type RecommendationQualityFixture = z.infer<typeof RecommendationQualityFixtureSchema>
export const recommendationQualityFixtures = z
  .array(RecommendationQualityFixtureSchema)
  .min(1)
  .refine((fixtures) => new Set(fixtures.map(({ id }) => id)).size === fixtures.length, {
    message: 'Fixture IDs must be unique',
  })
  .parse(fixtureData)

export const MAX_RECOMMENDATION_OUTPUT_LENGTH = 150_000

export type RecommendationQualityResult = {
  pass: boolean
  issues: string[]
  metrics: {
    returnedCount: number
    validCount: number
    duplicateCount: number
    seedLeakCount: number
    neighborHitCount: number
    neighborCheck: 'not_applicable' | 'passed' | 'failed'
  }
  judgments: {
    recommendationFit: 'unjudged'
    previewAvailability: 'unmeasured'
    delivery: 'unmeasured'
  }
}

function normalizeName(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase()
}

// Preserve the production parser's fence and reasoning-block handling,
// while retaining invalid rows that its validation intentionally drops.
function extractOriginalRows(output: string): unknown[] {
  let cleaned = stripReasoningBlocks(output).trim()
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) cleaned = fence[1]?.trim() ?? cleaned
  const raw: unknown = JSON.parse(cleaned)
  const rows = Array.isArray(raw)
    ? raw
    : raw !== null && typeof raw === 'object' && 'recommendations' in raw
      ? raw.recommendations
      : null
  if (!Array.isArray(rows)) throw new Error('Expected an array or recommendations wrapper')
  return rows
}

export function evaluateRecommendationOutput(
  output: string,
  fixture: RecommendationQualityFixture,
): RecommendationQualityResult {
  const result: RecommendationQualityResult = {
    pass: false,
    issues: [],
    metrics: {
      returnedCount: 0,
      validCount: 0,
      duplicateCount: 0,
      seedLeakCount: 0,
      neighborHitCount: 0,
      neighborCheck: fixture.expectedNeighbors.length ? 'failed' : 'not_applicable',
    },
    judgments: {
      recommendationFit: 'unjudged',
      previewAvailability: 'unmeasured',
      delivery: 'unmeasured',
    },
  }
  if (typeof output !== 'string' || output.length > MAX_RECOMMENDATION_OUTPUT_LENGTH) {
    result.issues.push('Output must be a string within the 150000-character limit')
    return result
  }
  try {
    const rows = extractOriginalRows(output)
    result.metrics.returnedCount = rows.length
    if (rows.length > 50) {
      result.issues.push('Output exceeds the 50-row payload limit')
      return result
    }
    const recommendations = parseRecommendationResponse(JSON.stringify(rows))
    result.metrics.validCount = recommendations.length
    const invalidCount = rows.filter(
      (row) => !AiRecommendationItemSchema.safeParse(row).success,
    ).length
    if (invalidCount)
      result.issues.push(`${invalidCount} recommendation rows fail the production item schema`)
    if (rows.length < 15 || rows.length > 20) result.issues.push('Expected 15-20 recommendations')
    const exclusions = new Set([
      ...fixture.profile.topArtists.map(({ name }) => normalizeName(name)),
      ...(fixture.excludedArtists ?? []).map(normalizeName),
    ])
    const names = recommendations.map(({ artistName }) => normalizeName(artistName))
    const distinctNames = new Set(names)
    result.metrics.duplicateCount = names.length - distinctNames.size
    result.metrics.seedLeakCount = names.filter((name) => exclusions.has(name)).length
    const expectedNames = new Set(fixture.expectedNeighbors.map(normalizeName))
    result.metrics.neighborHitCount = [...distinctNames].filter((name) =>
      expectedNames.has(name),
    ).length
    if (result.metrics.duplicateCount)
      result.issues.push(`${result.metrics.duplicateCount} duplicate artist names`)
    if (result.metrics.seedLeakCount)
      result.issues.push(`${result.metrics.seedLeakCount} seed or excluded artists returned`)
    if (names.some((name) => !name))
      result.issues.push('Artist names must contain non-whitespace text')
    if (expectedNames.size) {
      result.metrics.neighborCheck = result.metrics.neighborHitCount ? 'passed' : 'failed'
      if (!result.metrics.neighborHitCount)
        result.issues.push('No expected neighbor artist names returned (advisory smoke check)')
    }
    result.pass = result.issues.length === 0
  } catch {
    result.issues.push('Could not parse a valid recommendations payload')
  }
  return result
}
