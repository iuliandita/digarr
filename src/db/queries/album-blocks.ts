import { and, eq } from 'drizzle-orm'
import type { Database, DbOrTx } from '@/db'
import { albumBlocks, artists } from '@/db/schema'

export async function createAlbumBlock(
  db: DbOrTx,
  params: {
    userId: number
    artistId: number
    releaseGroupMbid: string
    reason?: string
    reasonText?: string
    source?: string
  },
): Promise<void> {
  await db
    .insert(albumBlocks)
    .values({
      userId: params.userId,
      artistId: params.artistId,
      releaseGroupMbid: params.releaseGroupMbid,
      reason: params.reason,
      reasonText: params.reasonText,
      source: params.source ?? 'rejection',
    })
    .onConflictDoNothing({ target: [albumBlocks.userId, albumBlocks.releaseGroupMbid] })
}

export async function removeAlbumBlock(
  db: DbOrTx,
  params: { userId: number; releaseGroupMbid: string },
): Promise<void> {
  await db
    .delete(albumBlocks)
    .where(
      and(
        eq(albumBlocks.userId, params.userId),
        eq(albumBlocks.releaseGroupMbid, params.releaseGroupMbid),
      ),
    )
}

export async function getBlockedAlbumKeys(db: Database, userId: number): Promise<Set<string>> {
  const rows = await db
    .select({ releaseGroupMbid: albumBlocks.releaseGroupMbid })
    .from(albumBlocks)
    .where(eq(albumBlocks.userId, userId))
  return new Set(rows.map((r) => r.releaseGroupMbid))
}

export async function listAlbumBlocks(db: Database, userId: number) {
  return db
    .select({
      id: albumBlocks.id,
      artistId: albumBlocks.artistId,
      artistName: artists.name,
      artistMbid: artists.mbid,
      releaseGroupMbid: albumBlocks.releaseGroupMbid,
      reason: albumBlocks.reason,
      reasonText: albumBlocks.reasonText,
      blockedAt: albumBlocks.blockedAt,
    })
    .from(albumBlocks)
    .innerJoin(artists, eq(artists.id, albumBlocks.artistId))
    .where(eq(albumBlocks.userId, userId))
    .orderBy(albumBlocks.blockedAt)
}
