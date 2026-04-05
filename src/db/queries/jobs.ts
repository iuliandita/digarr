import { and, count, desc, eq, gte, isNotNull, sql } from 'drizzle-orm'
import type { JobRunRow, JobType, SourceResult } from '@/core/jobs/types'
import type { Database } from '@/db'
import { jobRuns } from '@/db/schema'

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

export type HealthSummary = {
  pipeline: { status: string; lastRun: string | null; nextRun: string | null }
  subscriptions: { status: string; healthy: number; total: number }
  playlists: { status: string; lastRun: string | null }
  sources: Record<string, string>
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
    sources,
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
