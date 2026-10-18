import { and, count, desc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm'
import type { JobRunRow, JobType, SourceResult } from '@/core/jobs/types'
import type { PlaylistExportOutcome, PlaylistGenerationSummary } from '@/core/playlists/types'
import { redactSecrets } from '@/core/validation'
import type { Database } from '@/db'
import { type JobMetadata, jobRuns, recommendations } from '@/db/schema'

export type ListJobsFilters = {
  type?: JobType
  status?: string
  limit?: number
  offset?: number
}

export async function listJobs(
  db: Database,
  filters: ListJobsFilters = {},
): Promise<{ items: JobRunRow[]; total: number }> {
  const limit = Math.min(filters.limit ?? 50, 100)
  const offset = filters.offset ?? 0

  const conditions = []
  if (filters.type) conditions.push(eq(jobRuns.type, filters.type))
  if (filters.status) conditions.push(eq(jobRuns.status, filters.status))

  const where = conditions.length > 0 ? and(...conditions) : undefined

  const [items, totalRows] = await Promise.all([
    db
      .select()
      .from(jobRuns)
      .where(where)
      .orderBy(desc(jobRuns.startedAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: count() }).from(jobRuns).where(where),
  ])

  return {
    items: items as JobRunRow[],
    total: totalRows[0]?.count ?? 0,
  }
}

export async function getJobById(db: Database, id: number): Promise<JobRunRow | null> {
  const [row] = await db.select().from(jobRuns).where(eq(jobRuns.id, id)).limit(1)
  return (row as JobRunRow) ?? null
}

export async function getLastWriteBackError(
  db: Database,
  userId: number,
  service: 'listenbrainz' | 'lastfm',
): Promise<string | null> {
  const [row] = await db
    .select({ error: jobRuns.error })
    .from(jobRuns)
    .where(
      and(
        eq(jobRuns.userId, userId),
        eq(jobRuns.type, 'target'),
        inArray(jobRuns.status, ['completed', 'failed']),
        sql`${jobRuns.metadata}->>'writeBackService' = ${service}`,
      ),
    )
    .orderBy(desc(jobRuns.startedAt), desc(jobRuns.id))
    .limit(1)
  return row?.error ?? null
}

export async function updateJobMetadata(
  db: Database,
  jobId: number,
  metadata: JobMetadata,
): Promise<void> {
  await db
    .update(jobRuns)
    .set({
      metadata: sql`${jobRuns.metadata} || ${JSON.stringify(metadata)}::jsonb`,
    })
    .where(eq(jobRuns.id, jobId))
}

export type PlaylistGeneration = {
  jobId: number
  status: string
  startedAt: Date
  completedAt: Date | null
  resolution: PlaylistGenerationSummary | null
  exports: PlaylistExportOutcome[] | null
}

const EXPORT_STATUSES = new Set(['submitted', 'partial', 'failed'])

function playlistExportOutcomes(value: unknown): PlaylistExportOutcome[] | null {
  if (!Array.isArray(value)) return null
  const optionalCount = (count: unknown) =>
    count === undefined || (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0)
  const projected: PlaylistExportOutcome[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return null
    const { targetId, targetName, targetType, status, verified, itemsAdded, itemsSkipped, error } =
      entry as Record<string, unknown>
    if (
      typeof targetId !== 'number' ||
      !Number.isSafeInteger(targetId) ||
      typeof targetName !== 'string' ||
      typeof targetType !== 'string' ||
      typeof status !== 'string' ||
      !EXPORT_STATUSES.has(status) ||
      typeof verified !== 'boolean' ||
      !optionalCount(itemsAdded) ||
      !optionalCount(itemsSkipped) ||
      (error !== undefined && typeof error !== 'string')
    )
      return null
    projected.push({
      targetId,
      targetName,
      targetType,
      status: status as PlaylistExportOutcome['status'],
      verified,
      ...(itemsAdded === undefined ? {} : { itemsAdded: itemsAdded as number }),
      ...(itemsSkipped === undefined ? {} : { itemsSkipped: itemsSkipped as number }),
      ...(error === undefined ? {} : { error }),
    })
  }
  return projected
}

export function playlistResolution(value: unknown): PlaylistGenerationSummary | null {
  if (!value || typeof value !== 'object') return null
  const summary = value as Record<string, unknown>
  const validCount = (count: unknown): count is number =>
    typeof count === 'number' && Number.isSafeInteger(count) && count >= 0
  const { requestedArtistCount, resolvedArtistCount, includedArtistCount, trackCount, outcomes } =
    summary
  if (
    !validCount(requestedArtistCount) ||
    !validCount(resolvedArtistCount) ||
    !validCount(includedArtistCount) ||
    !validCount(trackCount) ||
    !Array.isArray(outcomes)
  )
    return null
  const projected: PlaylistGenerationSummary['outcomes'] = []
  for (const value of outcomes) {
    if (!value || typeof value !== 'object') return null
    const outcome = value as Record<string, unknown>
    const { artistName, artistMbid, status, resolvedTrackCount, includedTrackCount } = outcome
    if (
      typeof artistName !== 'string' ||
      (artistMbid !== undefined && typeof artistMbid !== 'string') ||
      (status !== 'resolved' &&
        status !== 'unmatched' &&
        status !== 'unavailable' &&
        status !== 'error' &&
        status !== 'limited') ||
      !validCount(resolvedTrackCount) ||
      !validCount(includedTrackCount)
    )
      return null
    projected.push({
      artistName,
      ...(artistMbid === undefined ? {} : { artistMbid }),
      status,
      resolvedTrackCount,
      includedTrackCount,
    })
  }
  return {
    requestedArtistCount,
    resolvedArtistCount,
    includedArtistCount,
    trackCount,
    outcomes: projected,
  }
}

export async function getLatestPlaylistGeneration(
  db: Database,
  playlistId: number,
  userId: number,
): Promise<PlaylistGeneration | null> {
  const [row] = await db
    .select({
      jobId: jobRuns.id,
      status: jobRuns.status,
      startedAt: jobRuns.startedAt,
      completedAt: jobRuns.completedAt,
      resolution: sql<unknown>`${jobRuns.metadata}->'playlistResolution'`,
      exports: sql<unknown>`${jobRuns.metadata}->'playlistExports'`,
    })
    .from(jobRuns)
    .where(
      and(
        eq(jobRuns.type, 'playlist'),
        eq(jobRuns.userId, userId),
        sql`${jobRuns.metadata}->>'playlistId' = ${String(playlistId)}`,
      ),
    )
    .orderBy(desc(jobRuns.startedAt), desc(jobRuns.id))
    .limit(1)
  return row
    ? {
        ...row,
        resolution: playlistResolution(row.resolution),
        exports: playlistExportOutcomes(row.exports),
      }
    : null
}

export type IntegrationKind = 'target' | 'library' | 'source' | 'subscription' | 'scrobbler'

export type IntegrationHealth = {
  kind: IntegrationKind
  name: string
  status: 'ok' | 'failing'
  lastSuccess: string | null
  lastError: { at: string; message: string | null } | null
}

export const INTEGRATION_HEALTH_WINDOW_DAYS = 30
const INTEGRATION_ERROR_MAX_LENGTH = 300

function toIso(value: unknown): string | null {
  if (value == null) return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

// Derived only from recorded job_runs outcomes; never probes the services.
export async function getIntegrationHealth(db: Database): Promise<IntegrationHealth[]> {
  const since = new Date(Date.now() - INTEGRATION_HEALTH_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const result = await db.execute(sql`
    WITH events AS (
      SELECT
        CASE
          WHEN type = 'target' AND metadata->>'writeBackService' IS NOT NULL THEN 'scrobbler'
          WHEN type = 'target' THEN 'target'
          WHEN type = 'library_sync' THEN 'library'
          ELSE 'subscription'
        END AS kind,
        CASE
          WHEN type = 'target' THEN coalesce(metadata->>'writeBackService', metadata->>'targetType')
          WHEN type = 'library_sync' THEN metadata->>'source'
          ELSE metadata->>'adapterType'
        END AS name,
        status = 'completed' AS ok,
        error,
        coalesce(completed_at, started_at) AS at
      FROM ${jobRuns}
      WHERE type IN ('target', 'library_sync', 'subscription')
        AND status IN ('completed', 'failed')
        AND started_at >= ${since}
        AND coalesce(metadata->>'skipped', '') <> 'true'
      UNION ALL
      SELECT
        'source' AS kind,
        s.key AS name,
        s.value->>'status' = 'ok' AS ok,
        s.value->>'error' AS error,
        coalesce(j.completed_at, j.started_at) AS at
      FROM ${jobRuns} j
      CROSS JOIN LATERAL jsonb_each(
        CASE WHEN jsonb_typeof(j.source_results) = 'object' THEN j.source_results ELSE '{}'::jsonb END
      ) AS s
      WHERE j.type IN ('pipeline', 'quick_discover')
        AND j.started_at >= ${since}
        AND s.value->>'status' IN ('ok', 'error')
    )
    SELECT
      kind,
      name,
      max(at) FILTER (WHERE ok) AS last_success,
      max(at) FILTER (WHERE NOT ok) AS last_error_at,
      (array_agg(error ORDER BY at DESC) FILTER (WHERE NOT ok))[1] AS last_error
    FROM events
    WHERE name IS NOT NULL AND name <> ''
    GROUP BY kind, name
    ORDER BY kind, name
  `)

  const rows = result.rows as Array<{
    kind: IntegrationKind
    name: string
    last_success: unknown
    last_error_at: unknown
    last_error: string | null
  }>
  return rows.map((row) => {
    const lastSuccess = toIso(row.last_success)
    const lastErrorAt = toIso(row.last_error_at)
    const message = row.last_error
      ? redactSecrets(row.last_error).slice(0, INTEGRATION_ERROR_MAX_LENGTH)
      : null
    return {
      kind: row.kind,
      name: row.name,
      status: lastErrorAt && (!lastSuccess || lastErrorAt > lastSuccess) ? 'failing' : 'ok',
      lastSuccess,
      lastError: lastErrorAt ? { at: lastErrorAt, message } : null,
    }
  })
}

export type HealthSummary = {
  pipeline: { status: string; lastRun: string | null; nextRun: string | null }
  subscriptions: { status: string; healthy: number; total: number }
  playlists: { status: string; lastRun: string | null }
  librarySync?: { status: string; lastRun: string | null }
  sources: Record<string, string>
  integrations: IntegrationHealth[]
}

export async function getJobHealth(
  db: Database,
  nextPipelineRun: Date | null,
): Promise<HealthSummary> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000)

  // Last pipeline run
  const [lastPipeline] = await db
    .select()
    .from(jobRuns)
    .where(eq(jobRuns.type, 'pipeline'))
    .orderBy(desc(jobRuns.startedAt))
    .limit(1)

  // Last playlist run
  const [lastPlaylist] = await db
    .select()
    .from(jobRuns)
    .where(eq(jobRuns.type, 'playlist'))
    .orderBy(desc(jobRuns.startedAt))
    .limit(1)

  const [lastLibrarySync] = await db
    .select()
    .from(jobRuns)
    .where(eq(jobRuns.type, 'library_sync'))
    .orderBy(desc(jobRuns.startedAt))
    .limit(1)

  // Subscription health: group by subscriptionId for runs in last 24h
  const subRows = await db
    .select({
      subscriptionId: jobRuns.subscriptionId,
      status: jobRuns.status,
    })
    .from(jobRuns)
    .where(
      and(
        eq(jobRuns.type, 'subscription'),
        gte(jobRuns.startedAt, since24h),
        isNotNull(jobRuns.subscriptionId),
      ),
    )
    .orderBy(jobRuns.subscriptionId, desc(jobRuns.startedAt))

  // Deduplicate to latest status per subscriptionId
  const latestBySub = new Map<number, string>()
  for (const row of subRows) {
    if (row.subscriptionId !== null && !latestBySub.has(row.subscriptionId)) {
      latestBySub.set(row.subscriptionId, row.status)
    }
  }
  const subTotal = latestBySub.size
  const subHealthy = [...latestBySub.values()].filter((s) => s === 'completed').length
  let subsStatus = 'ok'
  if (subTotal > 0) {
    const failRate = (subTotal - subHealthy) / subTotal
    if (failRate >= 0.5) subsStatus = 'failing'
    else if (failRate > 0) subsStatus = 'degraded'
  }

  // Source health from recent pipeline/quick_discover runs
  const sourceRows = await db
    .select({ sourceResults: jobRuns.sourceResults })
    .from(jobRuns)
    .where(
      and(
        sql`${jobRuns.type} IN ('pipeline', 'quick_discover')`,
        gte(jobRuns.startedAt, since24h),
        isNotNull(jobRuns.sourceResults),
      ),
    )
    .orderBy(desc(jobRuns.startedAt))
    .limit(20)

  // Aggregate source statuses
  const sourceCounts: Record<string, { ok: number; total: number }> = {}
  for (const row of sourceRows) {
    const results = row.sourceResults as Record<string, SourceResult> | null
    if (!results) continue
    for (const [source, result] of Object.entries(results)) {
      if (result.status !== 'ok' && result.status !== 'error') continue
      if (!sourceCounts[source]) sourceCounts[source] = { ok: 0, total: 0 }
      sourceCounts[source].total++
      if (result.status === 'ok') sourceCounts[source].ok++
    }
  }
  const sources: Record<string, string> = {}
  for (const [source, counts] of Object.entries(sourceCounts)) {
    const failRate = counts.total > 0 ? (counts.total - counts.ok) / counts.total : 0
    if (failRate >= 0.5) sources[source] = 'failing'
    else if (failRate > 0) sources[source] = 'degraded'
    else sources[source] = 'ok'
  }

  // Pipeline status
  let pipelineStatus = 'ok'
  if (lastPipeline?.status === 'failed') pipelineStatus = 'failing'
  else if (lastPipeline?.status === 'stuck') pipelineStatus = 'degraded'

  // Playlist status
  let playlistStatus = 'ok'
  if (lastPlaylist?.status === 'failed') playlistStatus = 'failing'
  else if (lastPlaylist?.status === 'stuck') playlistStatus = 'degraded'

  let librarySyncStatus = 'ok'
  if (lastLibrarySync?.status === 'failed') librarySyncStatus = 'failing'
  else if (lastLibrarySync?.status === 'stuck') librarySyncStatus = 'degraded'

  return {
    pipeline: {
      status: pipelineStatus,
      lastRun: lastPipeline?.completedAt?.toISOString() ?? null,
      nextRun: nextPipelineRun?.toISOString() ?? null,
    },
    subscriptions: {
      status: subsStatus,
      healthy: subHealthy,
      total: subTotal,
    },
    playlists: {
      status: playlistStatus,
      lastRun: lastPlaylist?.completedAt?.toISOString() ?? null,
    },
    librarySync: {
      status: librarySyncStatus,
      lastRun: lastLibrarySync?.completedAt?.toISOString() ?? null,
    },
    sources,
    integrations: await getIntegrationHealth(db),
  }
}

export type DigestStats = {
  discovered: number
  added: number
  runs: number
}

/**
 * Aggregate notification-digest stats for the trailing window starting at
 * `since`. Derived from existing tables (no bookmark/migration):
 * - `discovered`: recommendations created in the window.
 * - `added`: recommendations approved or added to Lidarr in the window
 *   (by action time, so older recommendations acted on now count).
 * - `runs`: discovery job runs (pipeline/subscription/quick_discover) that
 *   completed in the window.
 */
export async function getDigestStats(db: Database, since: Date): Promise<DigestStats> {
  const [discoveredRows, addedRows, runRows] = await Promise.all([
    db
      .select({ count: count() })
      .from(recommendations)
      .where(
        and(
          gte(recommendations.createdAt, since),
          sql`coalesce(${recommendations.sources}->>'album_request', '') <> '0'`,
        ),
      ),
    db
      .select({ count: count() })
      .from(recommendations)
      .where(
        and(
          gte(recommendations.actedOnAt, since),
          sql`coalesce(${recommendations.sources}->>'album_request', '') <> '0'`,
          inArray(recommendations.status, ['approved', 'added_to_lidarr']),
        ),
      ),
    db
      .select({ count: count() })
      .from(jobRuns)
      .where(
        and(
          eq(jobRuns.status, 'completed'),
          gte(jobRuns.startedAt, since),
          inArray(jobRuns.type, ['pipeline', 'subscription', 'quick_discover']),
        ),
      ),
  ])

  return {
    discovered: discoveredRows[0]?.count ?? 0,
    added: addedRows[0]?.count ?? 0,
    runs: runRows[0]?.count ?? 0,
  }
}

export async function getJobsForSubscription(
  db: Database,
  subscriptionId: number,
  limit = 20,
): Promise<JobRunRow[]> {
  const rows = await db
    .select()
    .from(jobRuns)
    .where(and(eq(jobRuns.type, 'subscription'), eq(jobRuns.subscriptionId, subscriptionId)))
    .orderBy(desc(jobRuns.startedAt))
    .limit(limit)
  return rows as JobRunRow[]
}
