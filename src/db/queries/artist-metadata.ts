import { count, eq, sql } from 'drizzle-orm'
import type { Database } from '@/db'
import { artistMetadata } from '@/db/schema'

export type ArtistMetadataRow = {
  spotifyGenres: string[] | null
  spotifyPopularity: number | null
  deezerFans: number | null
}

export type ArtistMetadataInsert = {
  name: string
  nameNormalized: string
  spotifyGenres?: string[] | null
  spotifyPopularity?: number | null
  deezerFans?: number | null
}

export async function lookupByName(db: Database, name: string): Promise<ArtistMetadataRow | null> {
  const normalized = name.trim().toLowerCase()
  const [row] = await db
    .select({
      spotifyGenres: artistMetadata.spotifyGenres,
      spotifyPopularity: artistMetadata.spotifyPopularity,
      deezerFans: artistMetadata.deezerFans,
    })
    .from(artistMetadata)
    .where(eq(artistMetadata.nameNormalized, normalized))
    .limit(1)
  return row ?? null
}

// Postgres bind-parameter limit is 65535. artist_metadata inserts 5 cols per row
// (name, nameNormalized, spotifyGenres, spotifyPopularity, deezerFans), so keep
// chunks well under floor(65535/5)=13107. 5000 leaves headroom.
const BULK_UPSERT_CHUNK = 5000

export async function bulkUpsert(db: Database, rows: ArtistMetadataInsert[]): Promise<number> {
  if (rows.length === 0) return 0
  for (let i = 0; i < rows.length; i += BULK_UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + BULK_UPSERT_CHUNK)
    await db
      .insert(artistMetadata)
      .values(
        chunk.map((row) => ({
          name: row.name,
          nameNormalized: row.nameNormalized,
          spotifyGenres: row.spotifyGenres ?? null,
          spotifyPopularity: row.spotifyPopularity ?? null,
          deezerFans: row.deezerFans ?? null,
        })),
      )
      .onConflictDoUpdate({
        target: artistMetadata.nameNormalized,
        set: {
          name: sql`excluded.name`,
          spotifyGenres: sql`excluded.spotify_genres`,
          spotifyPopularity: sql`excluded.spotify_popularity`,
          deezerFans: sql`excluded.deezer_fans`,
          cachedAt: sql`now()`,
        },
      })
  }
  return rows.length
}

export async function getCount(db: Database): Promise<number> {
  const [row] = await db.select({ total: count() }).from(artistMetadata)
  return row?.total ?? 0
}

export async function getPopularityMap(db: Database): Promise<Map<string, number>> {
  const rows = await db
    .select({
      nameNormalized: artistMetadata.nameNormalized,
      spotifyPopularity: artistMetadata.spotifyPopularity,
    })
    .from(artistMetadata)
    .where(sql`${artistMetadata.spotifyPopularity} is not null`)
  const map = new Map<string, number>()
  for (const row of rows) {
    if (row.spotifyPopularity != null) {
      map.set(row.nameNormalized, row.spotifyPopularity / 100)
    }
  }
  return map
}
