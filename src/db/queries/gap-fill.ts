import { and, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'
import type { Database } from '@/db'
import { libraryArtists } from '@/db/schema'

export type GapFillArtist = { id: number; mbid: string; name: string }

/**
 * Reconciled (MBID-bearing) library artists for a user, ordered by the rotation
 * cursor (never-checked first, then oldest check), capped at `limit`. Each run
 * advances through the library so the live MusicBrainz coverage calls stay bounded.
 *
 * Scoping mirrors `getLibraryArtistsForUser`: per-user rows plus the global
 * (NULL `userId`) Lidarr rows, so gap-fill sees the same library the pipeline does.
 */
export async function getArtistsForGapFill(
  db: Database,
  userId: number,
  limit: number,
): Promise<GapFillArtist[]> {
  return db
    .select({ id: libraryArtists.id, mbid: libraryArtists.mbid, name: libraryArtists.name })
    .from(libraryArtists)
    .where(
      and(
        or(eq(libraryArtists.userId, userId), isNull(libraryArtists.userId)),
        isNotNull(libraryArtists.mbid),
      ),
    )
    .orderBy(sql`${libraryArtists.lastGapCheckAt} asc nulls first`)
    .limit(limit) as Promise<GapFillArtist[]>
}

/** Stamp the rotation cursor for the artists checked this run. */
export async function markArtistsGapChecked(db: Database, ids: number[]): Promise<void> {
  if (ids.length === 0) return
  await db
    .update(libraryArtists)
    .set({ lastGapCheckAt: new Date() })
    .where(inArray(libraryArtists.id, ids))
}
