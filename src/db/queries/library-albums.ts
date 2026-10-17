import { eq, isNull, or } from 'drizzle-orm'
import type { Database } from '@/db'
import { libraryAlbums } from '@/db/schema'

export type OwnedAlbumKeys = {
  releaseGroupMbids: Set<string>
  /** `${artistMbid}|${titleNormalized}` for owned rows that have no album MBID. */
  artistTitleKeys: Set<string>
}

export function ownedAlbumTitleKey(artistMbid: string, titleNormalized: string): string {
  return `${artistMbid}|${titleNormalized}`
}

/**
 * Albums in the user's synced library (per-user rows plus global NULL-user rows,
 * the same scope `getLibraryArtistsForUser` uses), for dropping album recommendations
 * the user already owns.
 */
export async function getOwnedAlbumKeys(db: Database, userId: number): Promise<OwnedAlbumKeys> {
  const rows = await db
    .select({
      albumMbid: libraryAlbums.albumMbid,
      artistMbid: libraryAlbums.artistMbid,
      titleNormalized: libraryAlbums.titleNormalized,
    })
    .from(libraryAlbums)
    .where(or(eq(libraryAlbums.userId, userId), isNull(libraryAlbums.userId)))

  const keys: OwnedAlbumKeys = { releaseGroupMbids: new Set(), artistTitleKeys: new Set() }
  for (const row of rows) {
    if (row.albumMbid) keys.releaseGroupMbids.add(row.albumMbid)
    else if (row.artistMbid && row.titleNormalized) {
      keys.artistTitleKeys.add(ownedAlbumTitleKey(row.artistMbid, row.titleNormalized))
    }
  }
  return keys
}
