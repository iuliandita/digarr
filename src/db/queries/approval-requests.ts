import { randomUUID } from 'node:crypto'
import { and, count, desc, eq, gte, sql } from 'drizzle-orm'
import type { Database } from '@/db'
import {
  approvalRequests,
  artists,
  recommendationBatches,
  recommendations,
  users,
} from '@/db/schema'

export class ApprovalRequestLimitError extends Error {
  constructor() {
    super('The maximum number of open approval requests has been reached')
    this.name = 'ApprovalRequestLimitError'
  }
}

export class ApprovalRequestNotFoundError extends Error {}
export class ApprovalRequestExecutionError extends Error {}
export const APPROVAL_REQUEST_DECLINE_COOLDOWN_MS = 24 * 60 * 60 * 1000
export class ApprovalRequestCooldownError extends Error {
  constructor() {
    super('This request was declined within the last 24 hours')
    this.name = 'ApprovalRequestCooldownError'
  }
}

const SYNTHETIC_ORIGIN = 'album_request'
function albumSnapshot(options: Record<string, unknown>) {
  return options._albumRequest as
    | {
        recommendationId: number
        artistId: number
        albumMbid: string
        albumTitle: string
        artistName: string
      }
    | undefined
}

async function cleanupSynthetic(
  db: Parameters<Parameters<Database['transaction']>[0]>[0],
  userId: number,
  recommendationId: number,
) {
  const [rec] = await db
    .select()
    .from(recommendations)
    .where(and(eq(recommendations.id, recommendationId), eq(recommendations.userId, userId)))
    .for('update')
  if (rec?.sources?.album_request !== 0) return
  const [pending] = await db
    .select({ id: approvalRequests.id })
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.recommendationId, recommendationId),
        eq(approvalRequests.status, 'pending'),
      ),
    )
  if (pending) return
  await db.delete(recommendations).where(eq(recommendations.id, rec.id))
  await db
    .delete(recommendationBatches)
    .where(
      and(
        eq(recommendationBatches.id, rec.batchId),
        sql`NOT EXISTS (SELECT 1 FROM ${recommendations} WHERE ${recommendations.batchId} = ${rec.batchId})`,
      ),
    )
}
const decisionLocks = new Map<number, Promise<void>>()

async function withDecisionLock<T>(id: number, work: () => Promise<T>): Promise<T> {
  const previous = decisionLocks.get(id) ?? Promise.resolve()
  let release = () => {}
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = previous.then(() => current)
  decisionLocks.set(id, tail)
  await previous
  try {
    return await work()
  } finally {
    release()
    if (decisionLocks.get(id) === tail) decisionLocks.delete(id)
  }
}

export function approvalRequestQueries(db: Database) {
  return {
    async create(userId: number, recommendationId: number, options: Record<string, unknown>) {
      return db.transaction(async (tx) => {
        const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update')
        if (!user) throw new ApprovalRequestNotFoundError()
        const [rec] = await tx
          .select()
          .from(recommendations)
          .where(and(eq(recommendations.id, recommendationId), eq(recommendations.userId, userId)))
        if (!rec) throw new ApprovalRequestNotFoundError()
        const [existing] = await tx
          .select()
          .from(approvalRequests)
          .where(
            and(
              eq(approvalRequests.userId, userId),
              eq(approvalRequests.recommendationId, recommendationId),
              eq(approvalRequests.status, 'pending'),
            ),
          )
        if (existing) return existing
        const cutoff = new Date(Date.now() - APPROVAL_REQUEST_DECLINE_COOLDOWN_MS)
        const [declined] = await tx
          .select({ id: approvalRequests.id })
          .from(approvalRequests)
          .where(
            and(
              eq(approvalRequests.userId, userId),
              eq(approvalRequests.status, 'declined'),
              gte(approvalRequests.decidedAt, cutoff),
              sql`(${approvalRequests.recommendationId} = ${recommendationId} OR (${approvalRequests.options}->'_albumRequest'->>'albumMbid' = ${rec.recommendedReleaseGroupId}))`,
            ),
          )
        if (declined) throw new ApprovalRequestCooldownError()
        let savedOptions = options
        if (rec.sources?.album_request === 0) {
          const [artist] = await tx
            .select({ name: artists.name })
            .from(artists)
            .where(eq(artists.id, rec.artistId))
          savedOptions = {
            ...options,
            _albumRequest: {
              recommendationId,
              artistId: rec.artistId,
              albumMbid: rec.recommendedReleaseGroupId,
              albumTitle: rec.recommendedReleaseGroupTitle,
              artistName: artist?.name ?? '',
            },
          }
        }
        if (user.maxOpenRequests !== null) {
          const [open] = await tx
            .select({ total: count() })
            .from(approvalRequests)
            .where(and(eq(approvalRequests.userId, userId), eq(approvalRequests.status, 'pending')))
          if ((open?.total ?? 0) >= user.maxOpenRequests) throw new ApprovalRequestLimitError()
        }
        const [request] = await tx
          .insert(approvalRequests)
          .values({
            token: randomUUID(),
            recommendationId,
            userId,
            options: savedOptions,
          })
          .returning()
        if (!request) throw new Error('Approval request was not created')
        return request
      })
    },
    async list(userId?: number) {
      const query = db
        .select({
          request: approvalRequests,
          recommendation: recommendations,
          artistName: artists.name,
          username: users.username,
        })
        .from(approvalRequests)
        .leftJoin(recommendations, eq(approvalRequests.recommendationId, recommendations.id))
        .leftJoin(artists, eq(recommendations.artistId, artists.id))
        .innerJoin(users, eq(approvalRequests.userId, users.id))
        .where(
          userId === undefined
            ? eq(approvalRequests.status, 'pending')
            : eq(approvalRequests.userId, userId),
        )
        .orderBy(desc(approvalRequests.createdAt), desc(approvalRequests.id))
      const rows = await query
      return rows.map(({ request, recommendation, artistName, username }) => ({
        ...request,
        requester: { id: request.userId, username },
        recommendation: {
          artistName: artistName ?? albumSnapshot(request.options)?.artistName ?? '',
          albumTitle:
            recommendation?.recommendedReleaseGroupTitle ??
            albumSnapshot(request.options)?.albumTitle ??
            null,
          score: recommendation?.score ?? 0,
          reasons: recommendation?.aiReasoning ? [recommendation.aiReasoning] : [],
        },
      }))
    },
    async decide(
      id: number,
      adminId: number,
      status: 'approved' | 'declined',
      note: string | null,
      execute: (request: typeof approvalRequests.$inferSelect) => Promise<void>,
    ) {
      return withDecisionLock(id, async () => {
        const request = await db.transaction(async (tx) => {
          const [request] = await tx
            .select()
            .from(approvalRequests)
            .where(eq(approvalRequests.id, id))
            .for('update')
          if (!request) throw new ApprovalRequestNotFoundError()
          return request
        })
        if (request.status !== 'pending') return { request, changed: false }
        if (status === 'approved') {
          try {
            await execute(request)
          } catch (error) {
            if (!(error instanceof ApprovalRequestExecutionError)) throw error
            const [failed] = await db
              .update(approvalRequests)
              .set({ lastError: error.message })
              .where(and(eq(approvalRequests.id, id), eq(approvalRequests.status, 'pending')))
              .returning()
            if (!failed) throw new Error('Approval request was not updated')
            return { request: failed, changed: false }
          }
        }
        return db.transaction(async (tx) => {
          const [decided] = await tx
            .update(approvalRequests)
            .set({ status, note, lastError: null, decidedBy: adminId, decidedAt: new Date() })
            .where(and(eq(approvalRequests.id, id), eq(approvalRequests.status, 'pending')))
            .returning()
          if (!decided) throw new Error('Approval request was not updated')
          if (status === 'declined' && request.recommendationId !== null)
            await cleanupSynthetic(tx, request.userId, request.recommendationId)
          const [saved] = await tx
            .select()
            .from(approvalRequests)
            .where(eq(approvalRequests.id, id))
          if (!saved) throw new Error('Approval request was not found after decision')
          return { request: saved, changed: true }
        })
      })
    },
    async cleanupAlbumRecommendation(userId: number, recommendationId: number) {
      return db.transaction(async (tx) => {
        await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update')
        await cleanupSynthetic(tx, userId, recommendationId)
      })
    },
    async ensureAlbumRecommendation(
      userId: number,
      artistId: number,
      albumMbid: string,
      albumTitle: string,
    ) {
      return db.transaction(async (tx) => {
        await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update')
        const [existing] = await tx
          .select()
          .from(recommendations)
          .where(
            and(
              eq(recommendations.userId, userId),
              eq(recommendations.artistId, artistId),
              eq(recommendations.recommendedReleaseGroupId, albumMbid),
              eq(recommendations.kind, 'album'),
              eq(recommendations.status, 'pending'),
            ),
          )
        if (existing) return existing.id
        const [batch] = await tx
          .insert(recommendationBatches)
          .values({ status: 'completed', stats: { _origin: SYNTHETIC_ORIGIN } })
          .returning({ id: recommendationBatches.id })
        if (!batch) throw new Error('Album recommendation batch was not created')
        const [rec] = await tx
          .insert(recommendations)
          .values({
            userId,
            artistId,
            batchId: batch.id,
            score: 0,
            sources: { album_request: 0 },
            status: 'pending',
            kind: 'album',
            recommendedReleaseGroupId: albumMbid,
            recommendedReleaseGroupTitle: albumTitle,
          })
          .returning({ id: recommendations.id })
        if (!rec) throw new Error('Album recommendation was not created')
        return rec.id
      })
    },
  }
}

export type ApprovalRequestQueries = ReturnType<typeof approvalRequestQueries>
