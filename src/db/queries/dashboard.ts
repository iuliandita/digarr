import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm'
import type { Database } from '@/db'
import {
  artists,
  jobRuns,
  recommendationBatches,
  recommendations,
  subscriptions,
  users,
} from '@/db/schema'

export type TasteGenre = {
  genre: string
  count: number
  percentage: number
}

export async function getTopGenresForUser(
  db: Database,
  userId: number | undefined,
  limit = 5,
): Promise<TasteGenre[]> {
  const statusFilter = inArray(recommendations.status, [
    'approved',
    'added_to_lidarr',
    'add_failed',
  ])
  const where = userId ? and(statusFilter, eq(recommendations.userId, userId)) : statusFilter

  const rows = await db
    .select({ genres: artists.genres })
    .from(recommendations)
    .innerJoin(artists, eq(recommendations.artistId, artists.id))
    .where(where)

  const genreCounts = new Map<string, number>()
  let totalGenreTags = 0
  for (const row of rows) {
    for (const genre of row.genres ?? []) {
      genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1)
      totalGenreTags++
    }
  }

  const sorted = [...genreCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit)

  return sorted.map(([genre, count]) => ({
    genre,
    count,
    percentage: totalGenreTags > 0 ? Math.round((count / totalGenreTags) * 100) : 0,
  }))
}

export type ActivityEntry = {
  type: 'approved' | 'rejected' | 'subscription_run' | 'scan_completed'
  timestamp: string
  data: {
    artistName?: string
    subscriptionName?: string
    artistsFound?: number
    artistsNew?: number
    discovered?: number
    added?: number
    username?: string
  }
}

export async function getRecentActivity(
  db: Database,
  userId: number | undefined,
  isAdmin: boolean,
  limit = 5,
): Promise<ActivityEntry[]> {
  const entries: ActivityEntry[] = []

  // 1. Recent recommendation actions
  const recWhere =
    userId && !isAdmin
      ? and(isNotNull(recommendations.actedOnAt), eq(recommendations.userId, userId))
      : isNotNull(recommendations.actedOnAt)

  const recentRecs = await db
    .select({
      status: recommendations.status,
      actedOnAt: recommendations.actedOnAt,
      artistName: artists.name,
      userId: recommendations.userId,
    })
    .from(recommendations)
    .innerJoin(artists, eq(recommendations.artistId, artists.id))
    .where(recWhere)
    .orderBy(desc(recommendations.actedOnAt))
    .limit(10)

  let userMap = new Map<number, string>()
  if (isAdmin && recentRecs.length > 0) {
    const userIds = [...new Set(recentRecs.map((r) => r.userId).filter(Boolean))] as number[]
    if (userIds.length > 0) {
      const userRows = await db
        .select({ id: users.id, username: users.username })
        .from(users)
        .where(inArray(users.id, userIds))
      userMap = new Map(userRows.map((u) => [u.id, u.username]))
    }
  }

  for (const rec of recentRecs) {
    const status = rec.status === 'rejected' ? ('rejected' as const) : ('approved' as const)
    entries.push({
      type: status,
      timestamp: rec.actedOnAt?.toISOString() ?? '',
      data: {
        artistName: rec.artistName,
        username: isAdmin && rec.userId ? userMap.get(rec.userId) : undefined,
      },
    })
  }

  // 2. Recent subscription runs (from job_runs)
  const typeFilter = eq(jobRuns.type, 'subscription')
  const subRunWhere =
    userId && !isAdmin ? and(typeFilter, eq(subscriptions.userId, userId)) : typeFilter

  const recentRuns = await db
    .select({
      startedAt: jobRuns.startedAt,
      metadata: jobRuns.metadata,
      subName: subscriptions.name,
      subUserId: subscriptions.userId,
    })
    .from(jobRuns)
    .innerJoin(subscriptions, eq(jobRuns.subscriptionId, subscriptions.id))
    .where(subRunWhere)
    .orderBy(desc(jobRuns.startedAt))
    .limit(5)

  for (const run of recentRuns) {
    const meta = (run.metadata ?? {}) as Record<string, unknown>
    entries.push({
      type: 'subscription_run',
      timestamp: run.startedAt.toISOString(),
      data: {
        subscriptionName: run.subName,
        artistsFound: (meta.artistsFound as number) ?? 0,
        artistsNew: (meta.artistsNew as number) ?? 0,
      },
    })
  }

  // 3. Recent batches (scan events) - admin sees all
  if (isAdmin) {
    const recentBatches = await db
      .select({
        createdAt: recommendationBatches.createdAt,
        stats: recommendationBatches.stats,
      })
      .from(recommendationBatches)
      .orderBy(desc(recommendationBatches.createdAt))
      .limit(5)

    for (const batch of recentBatches) {
      const stats = batch.stats as { discovered?: number; added?: number } | null
      entries.push({
        type: 'scan_completed',
        timestamp: batch.createdAt.toISOString(),
        data: {
          discovered: stats?.discovered ?? 0,
          added: stats?.added ?? 0,
        },
      })
    }
  }

  entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  return entries.slice(0, limit)
}
