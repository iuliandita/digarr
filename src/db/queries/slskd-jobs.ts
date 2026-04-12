import { and, desc, eq, inArray } from 'drizzle-orm'
import type { Database } from '@/db'
import { slskdJobs } from '@/db/schema'

const ACTIVE_SLSKD_JOB_STATES = [
  'pending',
  'searching',
  'queued',
  'downloading',
  'import_pending',
] as const

export type SlskdJobState =
  | (typeof ACTIVE_SLSKD_JOB_STATES)[number]
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
  return and(eq(slskdJobs.workKey, workKey), inArray(slskdJobs.state, ACTIVE_SLSKD_JOB_STATES))
}

export async function createSlskdJob(
  db: Database,
  data: CreateSlskdJobInput,
): Promise<SlskdJobRow> {
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
    .returning()

  if (!row) {
    throw new Error('createSlskdJob: no row returned')
  }

  return row as SlskdJobRow
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

export async function listPendingSlskdJobs(
  db: Database,
  limit = 50,
): Promise<SlskdJobRow[]> {
  const rows = await db
    .select()
    .from(slskdJobs)
    .where(inArray(slskdJobs.state, ACTIVE_SLSKD_JOB_STATES))
    .orderBy(desc(slskdJobs.createdAt), desc(slskdJobs.id))
    .limit(limit)

  return rows as SlskdJobRow[]
}

export async function updateSlskdJobState(
  db: Database,
  id: number,
  state: SlskdJobState,
  extra: SlskdJobUpdate = {},
): Promise<void> {
  await db
    .update(slskdJobs)
    .set({
      ...extra,
      state,
      updatedAt: new Date(),
    })
    .where(eq(slskdJobs.id, id))
}
