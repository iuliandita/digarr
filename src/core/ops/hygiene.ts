import { and, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm'
import { applyAlbumModifier, computeWeightedScore } from '@/core/pipeline/score'
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

  const result = await db
    .update(artists)
    .set({ imageFailedAt: null })
    .where(conditions.length === 1 ? conditions[0] : and(...conditions))

  return { tool: 'clear-image-failures', cleared: result.rowCount ?? 0 }
}

export async function purgeSessions(db: OpsDb): Promise<HygieneResult> {
  const result = await db.delete(sessions).where(lt(sessions.expiresAt, new Date()))

  return { tool: 'purge-sessions', purged: result.rowCount ?? 0 }
}

// ── Complex Hygiene ────────────────────────────

export async function dedupeRepair(db: OpsDb): Promise<HygieneResult> {
  // Find duplicate (userId, artistId) groups
  const dupeGroups = await db
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
    const recs = await db
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

    await db
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

  const [artistRows, metaRows] = await Promise.all([
    db.select({ tags: artists.tags, genres: artists.genres }).from(artists),
    db.select({ spotifyGenres: artistMetadata.spotifyGenres }).from(artistMetadata),
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
  await db.delete(genres)

  if (genreCounts.size > 0) {
    const rows = Array.from(genreCounts, ([name, count]) => ({
      name,
      slug: slugify(name),
      source: 'rebuild',
      artistCount: count,
      cachedAt: new Date(),
    }))
    // genres has ~6 columns; 2000 rows = ~12k params, safely under the 65535 cap.
    const CHUNK = 2000
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK)
      await db
        .insert(genres)
        .values(chunk)
        .onConflictDoUpdate({
          target: genres.slug,
          set: {
            artistCount: sql`excluded.artist_count`,
            cachedAt: sql`excluded.cached_at`,
            source: sql`excluded.source`,
          },
        })
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1)
  return { tool: 'rebuild-genres', genres: genreCounts.size, elapsed: `${elapsed}s` }
}

// ── Rescore Recommendations ─────────────────────

function isScoreComponent(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

function rescoreOne(
  sources: Record<string, number> | null,
  kind: string,
  weights: ScoringWeights,
): number | null {
  if (kind !== 'artist' && kind !== 'album') return null
  if (!sources || typeof sources !== 'object' || Array.isArray(sources)) return null
  const { consensus, similarity, genreOverlap, aiConfidence, feedbackBoost } = sources
  if (
    !isScoreComponent(consensus) ||
    !isScoreComponent(similarity) ||
    !isScoreComponent(genreOverlap) ||
    !isScoreComponent(aiConfidence) ||
    !isScoreComponent(feedbackBoost)
  ) {
    return null
  }
  if ('popularity' in sources && !isScoreComponent(sources.popularity)) return null
  if (
    kind === 'album' &&
    ['recency', 'gapPriority'].some((key) => key in sources && !isScoreComponent(sources[key]))
  ) {
    return null
  }

  const baseScore = computeWeightedScore(weights, {
    consensus,
    similarity,
    genreOverlap,
    aiConfidence,
    feedbackBoost,
    popularity: sources.popularity ?? 0,
  })
  return kind === 'album' ? applyAlbumModifier(baseScore, sources) : baseScore
}

export async function rescoreRecommendations(
  db: OpsDb,
  userId: number,
  weights: ScoringWeights,
  statusFilter: string[] = ['pending'],
): Promise<HygieneResult> {
  const recs = await db
    .select({
      recId: recommendations.id,
      sources: recommendations.sources,
      score: recommendations.score,
      kind: recommendations.kind,
      status: recommendations.status,
    })
    .from(recommendations)
    .where(and(eq(recommendations.userId, userId), inArray(recommendations.status, statusFilter)))

  // Bound arrays keep large batches below the Postgres parameter limit.
  const updates = recs.flatMap((rec) => {
    const score = rescoreOne(rec.sources, rec.kind, weights)
    return score === null ? [] : [{ ...rec, newScore: score }]
  })

  let rescored = 0
  const CHUNK = 5000
  for (let i = 0; i < updates.length; i += CHUNK) {
    const chunk = updates.slice(i, i + CHUNK)
    const ids = chunk.map((u) => u.recId)
    const scores = chunk.map((u) => u.newScore)
    const originalScores = chunk.map((u) => u.score)
    const originalSources = chunk.map((u) => JSON.stringify(u.sources))
    const originalStatuses = chunk.map((u) => u.status)
    const originalKinds = chunk.map((u) => u.kind)
    const result = await db.execute(sql`
      UPDATE ${recommendations}
      SET score = v.score
      FROM unnest(${sql.param(ids)}::int[], ${sql.param(scores)}::real[],
        ${sql.param(originalScores)}::real[], ${sql.param(originalSources)}::jsonb[],
        ${sql.param(originalStatuses)}::text[], ${sql.param(originalKinds)}::text[])
        AS v(id, score, original_score, original_sources, original_status, original_kind)
      WHERE ${recommendations.id} = v.id
        AND ${recommendations.userId} = ${userId}
        AND ${inArray(recommendations.status, statusFilter)}
        AND ${recommendations.status} = v.original_status
        AND ${recommendations.kind} = v.original_kind
        AND ${recommendations.score} IS NOT DISTINCT FROM v.original_score
        AND ${recommendations.sources} IS NOT DISTINCT FROM v.original_sources
    `)
    rescored += result.rowCount ?? 0
  }

  return {
    tool: 'rescore',
    rescored,
    skipped: recs.length - rescored,
    skippedInvalid: recs.length - updates.length,
    skippedConcurrent: updates.length - rescored,
    weightProfile: weights,
  }
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

  const recs = await db
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
          await db
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
