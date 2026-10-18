import { randomUUID } from 'node:crypto'
import { and, count, desc, eq } from 'drizzle-orm'
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
          .select({ id: recommendations.id })
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
            options,
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
        .innerJoin(recommendations, eq(approvalRequests.recommendationId, recommendations.id))
        .innerJoin(artists, eq(recommendations.artistId, artists.id))
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
          artistName,
          albumTitle: recommendation.recommendedReleaseGroupTitle,
          score: recommendation.score,
          reasons: recommendation.aiReasoning ? [recommendation.aiReasoning] : [],
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
        if (status === 'approved') await execute(request)
        const [decided] = await db
          .update(approvalRequests)
          .set({ status, note, decidedBy: adminId, decidedAt: new Date() })
          .where(and(eq(approvalRequests.id, id), eq(approvalRequests.status, 'pending')))
          .returning()
        if (!decided) throw new Error('Approval request was not updated')
        return { request: decided, changed: true }
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
          .values({ status: 'completed' })
          .returning({ id: recommendationBatches.id })
        if (!batch) throw new Error('Album recommendation batch was not created')
        const [rec] = await tx
          .insert(recommendations)
          .values({
            userId,
            artistId,
            batchId: batch.id,
            score: 0,
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
