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
  // Only pending rows are candidates: acted-on rows record user decisions, and album
  // recs for different release groups by one artist are distinct recommendations.
  const result = await db.execute<{ id: number; group_key: string }>(sql`
    WITH ranked AS (
      SELECT id,
        concat_ws(':', coalesce(user_id::text, ''), artist_id, kind,
          coalesce(recommended_release_group_id, '')) AS group_key,
        row_number() OVER (
          PARTITION BY user_id, artist_id, kind, coalesce(recommended_release_group_id, '')
          ORDER BY score DESC, id ASC
        ) AS rn
      FROM ${recommendations}
      WHERE status = 'pending'
    )
    UPDATE ${recommendations} AS r
    SET status = 'duplicate'
    FROM ranked
    WHERE r.id = ranked.id AND ranked.rn > 1 AND r.status = 'pending'
    RETURNING ranked.id, ranked.group_key
  `)

  const rows = result.rows as Array<{ id: number; group_key: string }>
  return {
    tool: 'dedupe',
    duplicateGroups: new Set(rows.map((row) => row.group_key)).size,
    removed: rows.length,
  }
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

  // Names that slugify alike ("hip hop", "hip-hop") share one row; a second row per
  // slug in one INSERT ... ON CONFLICT would abort the whole rebuild.
  const bySlug = new Map<string, { count: number; names: Map<string, number> }>()
  function countRow(rowGenres: string[]) {
    const seen = new Map<string, string>()
    for (const g of rowGenres) {
      const name = g.toLowerCase().trim()
      const slug = slugify(name)
      if (slug && !seen.has(slug)) seen.set(slug, name)
    }
    for (const [slug, name] of seen) {
      const entry = bySlug.get(slug) ?? { count: 0, names: new Map<string, number>() }
      entry.count += 1
      entry.names.set(name, (entry.names.get(name) ?? 0) + 1)
      bySlug.set(slug, entry)
    }
  }
  for (const row of artistRows) countRow([...(row.tags ?? []), ...(row.genres ?? [])])
  for (const row of metaRows) countRow(row.spotifyGenres ?? [])

  const cachedAt = new Date()
  const rows = Array.from(bySlug, ([slug, entry]) => {
    const [name] = [...entry.names].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? [
      slug,
    ]
    return { name, slug, source: 'rebuild', artistCount: entry.count, cachedAt }
  })

  await db.transaction(async (tx) => {
    await tx.delete(genres)
    // genres has ~6 columns; 2000 rows = ~12k params, safely under the 65535 cap.
    const CHUNK = 2000
    for (let i = 0; i < rows.length; i += CHUNK) {
      await tx.insert(genres).values(rows.slice(i, i + CHUNK))
    }
  })

  const elapsed = ((Date.now() - start) / 1000).toFixed(1)
  return { tool: 'rebuild-genres', genres: rows.length, elapsed: `${elapsed}s` }
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

  // Only a started background auto-fix may keep the lock past this call.
  let keepLock = false
  try {
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
    keepLock = autoFixStarted

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
  } finally {
    if (!keepLock) auditState.inProgress = false
  }
}
