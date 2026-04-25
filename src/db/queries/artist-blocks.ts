import { and, desc, eq, ilike, isNotNull, lt, or, type SQL } from 'drizzle-orm'
import type { RejectionReason } from '@/core/recommendations/rejection-reasons'
import type { Database } from '@/db'
import { artistBlocks, artists } from '@/db/schema'

export type BlockSource = 'rejection' | 'manual'

export type BlockedArtistRow = {
  artistId: number
  name: string
  mbid: string | null
  reason: RejectionReason | null
  reasonText: string | null
  blockedAt: Date
}

export type ListBlocksCursor = { id: number; ts: number }

export type ListBlocksResult = {
  items: BlockedArtistRow[]
  nextCursor: ListBlocksCursor | null
}

export async function addBlock(
  db: Database,
  params: {
    userId: number
    artistId: number
    reason?: RejectionReason | null
    reasonText?: string | null
    source?: BlockSource
  },
): Promise<void> {
  const { userId, artistId, reason = null, reasonText = null, source = 'rejection' } = params
  await db
    .insert(artistBlocks)
    .values({ userId, artistId, reason, reasonText, source })
    .onConflictDoUpdate({
      target: [artistBlocks.userId, artistBlocks.artistId],
      set: { reason, reasonText, blockedAt: new Date() },
    })
}

export async function removeBlock(
  db: Database,
  params: { userId: number; artistId: number },
): Promise<boolean> {
  const result = await db
    .delete(artistBlocks)
    .where(and(eq(artistBlocks.userId, params.userId), eq(artistBlocks.artistId, params.artistId)))
    .returning({ id: artistBlocks.id })
  return result.length > 0
}

export async function listBlocks(
  db: Database,
  params: {
    userId: number
    limit?: number
    cursor?: ListBlocksCursor | null
    q?: string | null
  },
): Promise<ListBlocksResult> {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200)
  const conditions: SQL[] = [eq(artistBlocks.userId, params.userId)]
  const trimmedQ = params.q?.trim()
  if (trimmedQ) {
    conditions.push(ilike(artists.name, `%${trimmedQ}%`))
  }
  if (params.cursor) {
    const cursorDate = new Date(params.cursor.ts)
    const cursorClause = or(
      lt(artistBlocks.blockedAt, cursorDate),
      and(eq(artistBlocks.blockedAt, cursorDate), lt(artistBlocks.id, params.cursor.id)),
    )
    if (cursorClause) conditions.push(cursorClause)
  }
  const rows = await db
    .select({
      id: artistBlocks.id,
      artistId: artistBlocks.artistId,
      name: artists.name,
      mbid: artists.mbid,
      reason: artistBlocks.reason,
      reasonText: artistBlocks.reasonText,
      blockedAt: artistBlocks.blockedAt,
    })
    .from(artistBlocks)
    .innerJoin(artists, eq(artists.id, artistBlocks.artistId))
    .where(and(...conditions))
    .orderBy(desc(artistBlocks.blockedAt), desc(artistBlocks.id))
    .limit(limit + 1)
  const hasMore = rows.length > limit
  const sliced = hasMore ? rows.slice(0, limit) : rows
  const items: BlockedArtistRow[] = sliced.map((r) => ({
    artistId: r.artistId,
    name: r.name,
    mbid: r.mbid,
    reason: r.reason as RejectionReason | null,
    reasonText: r.reasonText,
    blockedAt: r.blockedAt,
  }))
  let nextCursor: ListBlocksCursor | null = null
  if (hasMore) {
    const lastRow = sliced[sliced.length - 1]
    const lastItem = items[items.length - 1]
    if (lastRow && lastItem) {
      nextCursor = { id: lastRow.id, ts: lastItem.blockedAt.getTime() }
    }
  }
  return { items, nextCursor }
}

export async function getBlockedMbids(db: Database, userId: number): Promise<Set<string>> {
  const rows = await db
    .select({ mbid: artists.mbid })
    .from(artistBlocks)
    .innerJoin(artists, eq(artists.id, artistBlocks.artistId))
    .where(and(eq(artistBlocks.userId, userId), isNotNull(artists.mbid)))
  return new Set(rows.map((r) => r.mbid).filter((m): m is string => m != null))
}
