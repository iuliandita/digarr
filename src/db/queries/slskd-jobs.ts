import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import {
  collectFailedReleases,
  SLSKD_MAX_AUTO_RETRIES,
  SLSKD_RETRY_BACKOFF_MS,
} from '@/core/slskd/shared'
import type { Database } from '@/db'
import { SLSKD_ACTIVE_JOB_STATES, slskdJobs } from '@/db/schema'

export type SlskdJobState =
  | (typeof SLSKD_ACTIVE_JOB_STATES)[number]
  | 'completed'
  | 'failed'
  | 'cancelled'

export type CreateSlskdJobInput = {
  userId?: number | null
  targetId: number
  recommendationId?: number | null
  sourceType: string
  workKey: string
  artistMbid: string
  artistName: string
  releaseGroupMbid?: string | null
  releaseTitle: string
  lidarrArtistId?: number | null
  lidarrAlbumId?: number | null
  state?: SlskdJobState
  confidence?: number | null
  slskdSearchId?: string | null
  slskdQueueId?: string | null
  slskdDownloadId?: string | null
  selectedResult?: Record<string, unknown> | null
  lastError?: string | null
  attempts?: number
  completedAt?: Date | null
}

export type SlskdJobUpdate = Partial<
  Pick<
    CreateSlskdJobInput,
    | 'userId'
    | 'recommendationId'
    | 'sourceType'
    | 'workKey'
    | 'artistMbid'
    | 'artistName'
    | 'releaseGroupMbid'
    | 'releaseTitle'
    | 'lidarrArtistId'
    | 'lidarrAlbumId'
    | 'confidence'
    | 'slskdSearchId'
    | 'slskdQueueId'
    | 'slskdDownloadId'
    | 'selectedResult'
    | 'lastError'
    | 'attempts'
    | 'completedAt'
  >
>

export type SlskdJobRow = typeof slskdJobs.$inferSelect

const MANUAL_RETRY_COOLDOWN_MS = SLSKD_RETRY_BACKOFF_MS[0] as number
const AUTOMATIC_SOURCE_TYPE = 'lidarr_wanted'

function activeSlskdJobWhere(workKey: string) {
  return and(eq(slskdJobs.workKey, workKey), inArray(slskdJobs.state, SLSKD_ACTIVE_JOB_STATES))
}

async function findSlskdJobByWorkKey(db: Database, workKey: string): Promise<SlskdJobRow | null> {
  const conflictStates = [...SLSKD_ACTIVE_JOB_STATES, 'failed']
  const [row] = await db
    .select()
    .from(slskdJobs)
    .where(and(eq(slskdJobs.workKey, workKey), inArray(slskdJobs.state, conflictStates)))
    .orderBy(desc(slskdJobs.updatedAt), desc(slskdJobs.id))
    .limit(1)

  return (row as SlskdJobRow) ?? null
}

async function retryFailedSlskdJob(
  db: Database,
  row: SlskdJobRow,
  data: CreateSlskdJobInput,
): Promise<SlskdJobRow> {
  const updatedAt = row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt)
  // Wanted-list intake retries on its own up to a cap; an approval is a manual retry.
  const automatic = data.sourceType === AUTOMATIC_SOURCE_TYPE
  const retries = Math.max(0, row.attempts - 1)
  if (automatic && retries >= SLSKD_MAX_AUTO_RETRIES) return row
  const cooldown = automatic
    ? (SLSKD_RETRY_BACKOFF_MS[retries] ?? SLSKD_RETRY_BACKOFF_MS.at(-1) ?? 0)
    : MANUAL_RETRY_COOLDOWN_MS
  if (Date.now() - updatedAt.getTime() < cooldown) return row

  // A manual retry starts clean: the failure may have been a setup problem, not a bad release.
  const failedReleases = automatic ? collectFailedReleases(row.selectedResult) : []

  const [retried] = await db
    .update(slskdJobs)
    .set({
      userId: data.userId ?? null,
      targetId: data.targetId,
      recommendationId: data.recommendationId ?? null,
      sourceType: data.sourceType,
      artistMbid: data.artistMbid,
      artistName: data.artistName,
      releaseGroupMbid: data.releaseGroupMbid ?? null,
      releaseTitle: data.releaseTitle,
      lidarrArtistId: data.lidarrArtistId ?? null,
      lidarrAlbumId: data.lidarrAlbumId ?? null,
      state: 'pending',
      confidence: null,
      slskdSearchId: null,
      slskdQueueId: null,
      slskdDownloadId: null,
      selectedResult: failedReleases.length > 0 ? { failedReleases } : null,
      lastError: null,
      ...(automatic ? {} : { attempts: 0 }),
      completedAt: null,
      updatedAt: new Date(),
    })
    .where(and(eq(slskdJobs.id, row.id), eq(slskdJobs.state, 'failed')))
    .returning()

  if (!retried) {
    const active = await findActiveSlskdJobByWorkKey(db, data.workKey)
    if (active) return active
    throw new Error(`createSlskdJob: failed to retry row ${row.id}`)
  }
  return retried as SlskdJobRow
}

export async function createSlskdJob(
  db: Database,
  data: CreateSlskdJobInput,
): Promise<SlskdJobRow> {
  if (!data.artistName.trim() && !data.releaseTitle.trim()) {
    throw new Error('slskd job requires an artist name or release title')
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const [row] = await db
      .insert(slskdJobs)
      .values({
        userId: data.userId ?? null,
        targetId: data.targetId,
        recommendationId: data.recommendationId ?? null,
        sourceType: data.sourceType,
        workKey: data.workKey,
        artistMbid: data.artistMbid,
        artistName: data.artistName,
        releaseGroupMbid: data.releaseGroupMbid ?? null,
        releaseTitle: data.releaseTitle,
        lidarrArtistId: data.lidarrArtistId ?? null,
        lidarrAlbumId: data.lidarrAlbumId ?? null,
        state: data.state ?? 'pending',
        confidence: data.confidence ?? null,
        slskdSearchId: data.slskdSearchId ?? null,
        slskdQueueId: data.slskdQueueId ?? null,
        slskdDownloadId: data.slskdDownloadId ?? null,
        selectedResult: data.selectedResult ?? null,
        lastError: data.lastError ?? null,
        attempts: data.attempts ?? 0,
        completedAt: data.completedAt ?? null,
      })
      .onConflictDoNothing()
      .returning()

    if (row) {
      return row as SlskdJobRow
    }

    const existing = await findSlskdJobByWorkKey(db, data.workKey)
    if (existing) {
      return existing.state === 'failed' ? retryFailedSlskdJob(db, existing, data) : existing
    }
  }

  throw new Error('createSlskdJob: no row returned')
}

export async function findActiveSlskdJobByWorkKey(
  db: Database,
  workKey: string,
): Promise<SlskdJobRow | null> {
  const [row] = await db
    .select()
    .from(slskdJobs)
    .where(activeSlskdJobWhere(workKey))
    .orderBy(desc(slskdJobs.createdAt), desc(slskdJobs.id))
    .limit(1)

  return (row as SlskdJobRow) ?? null
}

export async function listPendingSlskdJobs(db: Database, limit = 50): Promise<SlskdJobRow[]> {
  const rows = await db
    .select()
    .from(slskdJobs)
    .where(inArray(slskdJobs.state, SLSKD_ACTIVE_JOB_STATES))
    .orderBy(asc(slskdJobs.createdAt), asc(slskdJobs.id))
    .limit(limit)

  return rows as SlskdJobRow[]
}

export async function listSlskdJobsForRecommendationTarget(
  db: Database,
  recommendationId: number,
  targetId: number,
): Promise<SlskdJobRow[]> {
  const rows = await db
    .select()
    .from(slskdJobs)
    .where(and(eq(slskdJobs.recommendationId, recommendationId), eq(slskdJobs.targetId, targetId)))
    .orderBy(desc(slskdJobs.createdAt), desc(slskdJobs.id))

  return rows as SlskdJobRow[]
}

export async function updateSlskdJobState(
  db: Database,
  id: number,
  state: SlskdJobState,
  extra: SlskdJobUpdate = {},
): Promise<SlskdJobRow> {
  const completedAt =
    state === 'completed' || state === 'failed' || state === 'cancelled'
      ? (extra.completedAt ?? new Date())
      : extra.completedAt

  const [row] = await db
    .update(slskdJobs)
    .set({
      ...extra,
      state,
      ...(completedAt !== undefined ? { completedAt } : {}),
      updatedAt: new Date(),
    })
    .where(eq(slskdJobs.id, id))
    .returning()

  if (!row) {
    throw new Error(`updateSlskdJobState: no row returned for id ${id}`)
  }

  return row as SlskdJobRow
}
