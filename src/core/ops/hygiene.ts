import { and, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm'
import { computeWeightedScore } from '@/core/pipeline/score'
import type { ScoringWeights } from '@/db/schema'
import { artistMetadata, artists, genres, recommendations, sessions } from '@/db/schema'
import type { AiAuditResult, AiAuditStatus, HygieneResult, OpsDb } from './types'

// ── Simple Hygiene ─────────────────────────────

export async function clearImageFailures(
  db: OpsDb,
  olderThanDays?: number,
): Promise<HygieneResult> {
  const conditions = [isNotNull(artists.imageFailedAt)]
  if (olderThanDays) {
    const cutoff = new Date(Date.now() - olderThanDays * 86400000)
    conditions.push(lt(artists.imageFailedAt, cutoff))
  }

  // biome-ignore lint/suspicious/noExplicitAny: drizzle dynamic where
  const result = await (db as any)
    .update(artists)
    .set({ imageFailedAt: null })
    .where(conditions.length === 1 ? conditions[0] : and(...conditions))

  return { tool: 'clear-image-failures', cleared: result.rowCount ?? 0 }
}

export async function purgeSessions(db: OpsDb): Promise<HygieneResult> {
  // biome-ignore lint/suspicious/noExplicitAny: drizzle dynamic where
  const result = await (db as any).delete(sessions).where(lt(sessions.expiresAt, new Date()))

  return { tool: 'purge-sessions', purged: result.rowCount ?? 0 }
}

// ── Complex Hygiene ────────────────────────────

export async function dedupeRepair(db: OpsDb): Promise<HygieneResult> {
  // Find duplicate (userId, artistId) groups
  // biome-ignore lint/suspicious/noExplicitAny: drizzle dynamic query
  const dupeGroups = await (db as any)
    .select({
      userId: recommendations.userId,
      artistId: recommendations.artistId,
      cnt: sql<number>`count(*)::int`,
    })
    .from(recommendations)
    .groupBy(recommendations.userId, recommendations.artistId)
    .having(sql`count(*) > 1`)

  let removed = 0

  for (const group of dupeGroups) {
    // Get all recs in this group, ordered by score desc
    // biome-ignore lint/suspicious/noExplicitAny: drizzle dynamic query
    const recs = await (db as any)
      .select({
        id: recommendations.id,
        score: recommendations.score,
        sources: recommendations.sources,
        status: recommendations.status,
      })
      .from(recommendations)
      .where(
        and(
          group.userId != null
            ? eq(recommendations.userId, group.userId)
            : sql`${recommendations.userId} IS NULL`,
          eq(recommendations.artistId, group.artistId),
        ),
      )
      .orderBy(sql`${recommendations.score} DESC`)

    if (recs.length <= 1) continue

    // Keep the highest-scored one, mark rest as duplicate
    const duplicateIds = recs.slice(1).map((r: { id: number }) => r.id)

    // biome-ignore lint/suspicious/noExplicitAny: drizzle dynamic query
    await (db as any)
      .update(recommendations)
      .set({ status: 'duplicate' })
      .where(inArray(recommendations.id, duplicateIds))

    removed += duplicateIds.length
  }

  return { tool: 'dedupe', duplicateGroups: dupeGroups.length, removed }
}

// ── Rebuild Genres ──────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export async function rebuildGenres(db: OpsDb): Promise<HygieneResult> {
  const start = Date.now()

  // biome-ignore lint/suspicious/noExplicitAny: drizzle dynamic query
  const [artistRows, metaRows] = await Promise.all([
    (db as any).select({ tags: artists.tags, genres: artists.genres }).from(artists),
    (db as any).select({ spotifyGenres: artistMetadata.spotifyGenres }).from(artistMetadata),
  ])

  const genreCounts = new Map<string, number>()

  for (const row of artistRows) {
    const allGenres = [...(row.tags ?? []), ...(row.genres ?? [])]
    for (const g of allGenres) {
      const normalized = g.toLowerCase().trim()
      if (normalized) genreCounts.set(normalized, (genreCounts.get(normalized) ?? 0) + 1)
    }
  }

  for (const row of metaRows) {
    for (const g of row.spotifyGenres ?? []) {
      const normalized = g.toLowerCase().trim()
      if (normalized) genreCounts.set(normalized, (genreCounts.get(normalized) ?? 0) + 1)
    }
  }

  // Clear and rebuild
  // biome-ignore lint/suspicious/noExplicitAny: drizzle dynamic query
  await (db as any).delete(genres).execute()

  for (const [name, count] of genreCounts) {
    // biome-ignore lint/suspicious/noExplicitAny: drizzle dynamic query
    await (db as any)
      .insert(genres)
      .values({
        name,
        slug: slugify(name),
        source: 'rebuild',
        artistCount: count,
        cachedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: genres.slug,
        set: { artistCount: count, cachedAt: new Date(), source: 'rebuild' },
      })
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1)
  return { tool: 'rebuild-genres', genres: genreCounts.size, elapsed: `${elapsed}s` }
}

// ── Rescore Recommendations ─────────────────────

function computeGenreOverlap(artistGenres: string[], libraryGenres: string[]): number {
  if (artistGenres.length === 0 || libraryGenres.length === 0) return 0
  const libSet = new Set(libraryGenres.map((g) => g.toLowerCase()))
  const matches = artistGenres.filter((g) => libSet.has(g.toLowerCase()))
  return matches.length / Math.max(artistGenres.length, 1)
}

function rescoreOne(
  sources: Record<string, number>,
  artistGenres: string[],
  libraryGenres: string[],
  weights: ScoringWeights,
): number {
  const sourceKeys = Object.keys(sources)
  const sourceValues = Object.values(sources)

  return computeWeightedScore(weights, {
    consensus: Math.min(sourceKeys.length / 3, 1),
    similarity: sourceValues.length > 0 ? Math.max(...sourceValues) : 0,
    genreOverlap: computeGenreOverlap(artistGenres, libraryGenres),
    aiConfidence: sources.ai ?? 0,
    feedbackBoost: 0,
    popularity: 0,
  })
}

export async function rescoreRecommendations(
  db: OpsDb,
  weights: ScoringWeights,
  libraryGenres: string[],
  statusFilter: string[] = ['pending'],
): Promise<HygieneResult> {
  // biome-ignore lint/suspicious/noExplicitAny: drizzle dynamic query
  const recs = await (db as any)
    .select({
      recId: recommendations.id,
      sources: recommendations.sources,
      artistGenres: artists.genres,
      artistTags: artists.tags,
      artistName: artists.name,
    })
    .from(recommendations)
    .innerJoin(artists, eq(recommendations.artistId, artists.id))
    .where(inArray(recommendations.status, statusFilter))

  let rescored = 0
  for (const rec of recs) {
    const allGenres = [...(rec.artistGenres ?? []), ...(rec.artistTags ?? [])]
    const newScore = rescoreOne(rec.sources ?? {}, allGenres, libraryGenres, weights)

    // biome-ignore lint/suspicious/noExplicitAny: drizzle dynamic query
    await (db as any)
      .update(recommendations)
      .set({ score: newScore })
      .where(eq(recommendations.id, rec.recId))

    rescored++
  }

  return { tool: 'rescore', rescored, weightProfile: weights }
}

// ── AI Reasoning Audit ──────────────────────────

let auditState: AiAuditStatus = { flaggedIds: [], fixedIds: [], inProgress: false }

export function getAiAuditStatus(): AiAuditStatus {
  return { ...auditState }
}

export async function aiReasoningAudit(
  db: OpsDb,
  autoFix?: {
    enabled: boolean
    generateReasoning: (artistName: string, genres: string[]) => Promise<string>
  },
): Promise<AiAuditResult> {
  // Lock immediately to prevent concurrent audits (TOCTOU fix)
  if (auditState.inProgress) {
    return { scanned: 0, flagged: 0, flaggedIds: [], autoFixStarted: false }
  }
  auditState = { flaggedIds: [], fixedIds: [], inProgress: true }

  // biome-ignore lint/suspicious/noExplicitAny: drizzle dynamic query
  const recs = await (db as any)
    .select({
      recId: recommendations.id,
      aiReasoning: recommendations.aiReasoning,
      artistName: artists.name,
      artistTags: artists.tags,
      artistGenres: artists.genres,
    })
    .from(recommendations)
    .innerJoin(artists, eq(recommendations.artistId, artists.id))
    .where(isNotNull(recommendations.aiReasoning))

  const flaggedIds: number[] = []

  for (const rec of recs) {
    const reasoning = (rec.aiReasoning as string).toLowerCase()
    const name = (rec.artistName as string).toLowerCase()
    const allGenres = [...(rec.artistTags ?? []), ...(rec.artistGenres ?? [])].map((g: string) =>
      g.toLowerCase(),
    )

    const namePresent = reasoning.includes(name)
    const genreOverlap = allGenres.some((g: string) => reasoning.includes(g))

    if (!namePresent && !genreOverlap) {
      flaggedIds.push(rec.recId as number)
    }
  }

  const autoFixStarted = !!(autoFix?.enabled && flaggedIds.length > 0)

  auditState = { flaggedIds, fixedIds: [], inProgress: autoFixStarted }

  if (autoFixStarted) {
    ;(async () => {
      for (const id of flaggedIds) {
        try {
          const rec = recs.find((r: { recId: number }) => r.recId === id)
          if (!rec) continue
          const allGenres = [...(rec.artistTags ?? []), ...(rec.artistGenres ?? [])]
          if (!autoFix) continue
          const newReasoning = await autoFix.generateReasoning(
            rec.artistName as string,
            allGenres as string[],
          )
          // biome-ignore lint/suspicious/noExplicitAny: drizzle dynamic query
          await (db as any)
            .update(recommendations)
            .set({ aiReasoning: newReasoning })
            .where(eq(recommendations.id, id))
          auditState.fixedIds.push(id)
        } catch (err) {
          console.error(`[hygiene] Failed to regenerate reasoning for rec ${id}:`, err)
        }
      }
      auditState.inProgress = false
    })().catch((err) => {
      console.error('[hygiene] AI audit auto-fix failed:', err)
      auditState.inProgress = false
    })
  }

  return {
    scanned: recs.length,
    flagged: flaggedIds.length,
    flaggedIds,
    autoFixStarted,
  }
}
