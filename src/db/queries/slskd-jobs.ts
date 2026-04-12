import { and, desc, eq, inArray } from 'drizzle-orm'
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

function activeSlskdJobWhere(workKey: string) {
  return and(eq(slskdJobs.workKey, workKey), inArray(slskdJobs.state, SLSKD_ACTIVE_JOB_STATES))
}

export async function createSlskdJob(
  db: Database,
  data: CreateSlskdJobInput,
): Promise<SlskdJobRow> {
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

    const existing = await findActiveSlskdJobByWorkKey(db, data.workKey)
    if (existing) {
      return existing
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
    .orderBy(desc(slskdJobs.createdAt), desc(slskdJobs.id))
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
