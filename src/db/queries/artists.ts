import { eq, sql } from 'drizzle-orm'
import type { Database } from '@/db'
import { artists } from '@/db/schema'

type ArtistRow = typeof artists.$inferSelect

export type ArtistInsert = {
  mbid: string
  name: string
  disambiguation?: string | null
  tags?: string[] | null
  genres?: string[] | null
  imageUrl?: string | null
  streamingUrls?: Record<string, string> | null
}

export async function upsertArtist(db: Database, artist: ArtistInsert): Promise<ArtistRow> {
  const rows = await db
    .insert(artists)
    .values({ ...artist, cachedAt: new Date() })
    .onConflictDoUpdate({
      target: artists.mbid,
      set: {
        name: artist.name,
        disambiguation: sql`COALESCE(excluded.disambiguation, ${artists.disambiguation})`,
        tags: sql`COALESCE(excluded.tags, ${artists.tags})`,
        genres: sql`COALESCE(excluded.genres, ${artists.genres})`,
        imageUrl: sql`COALESCE(excluded.image_url, ${artists.imageUrl})`,
        streamingUrls: sql`COALESCE(excluded.streaming_urls, ${artists.streamingUrls})`,
        cachedAt: new Date(),
      },
    })
    .returning()
  const row = rows[0]
  if (!row) throw new Error(`upsertArtist: no row returned for mbid=${artist.mbid}`)
  return row
}

export async function getArtistByMbid(db: Database, mbid: string): Promise<ArtistRow | null> {
  const rows = await db.select().from(artists).where(eq(artists.mbid, mbid)).limit(1)
  return rows[0] ?? null
}

export async function getArtistById(db: Database, id: number): Promise<ArtistRow | null> {
  const rows = await db.select().from(artists).where(eq(artists.id, id)).limit(1)
  return rows[0] ?? null
}

export async function bulkUpsertArtists(
  db: Database,
  artistsData: ArtistInsert[],
): Promise<ArtistRow[]> {
  const results: ArtistRow[] = []
  for (const artist of artistsData) {
    results.push(await upsertArtist(db, artist))
  }
  return results
}
