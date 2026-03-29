import { eq, sql } from 'drizzle-orm'
import type { Database } from '@/db'
import { artists, genres } from '@/db/schema'

export type ArtistRow = typeof artists.$inferSelect

export type ArtistInsert = {
  mbid: string
  name: string
  disambiguation?: string | null
  tags?: string[] | null
  genres?: string[] | null
  imageUrl?: string | null
  logoUrl?: string | null
  imageFailed?: boolean
  streamingUrls?: Record<string, string> | null
  beginYear?: number | null
  endYear?: number | null
}

export async function upsertArtist(db: Database, artist: ArtistInsert): Promise<ArtistRow> {
  const { imageFailed, ...artistData } = artist

  const imageFailedAtInsert = imageFailed ? new Date() : artist.imageUrl ? null : undefined

  const rows = await db
    .insert(artists)
    .values({
      ...artistData,
      imageFailedAt: imageFailedAtInsert,
      cachedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: artists.mbid,
      set: {
        name: artist.name,
        disambiguation: sql`COALESCE(excluded.disambiguation, ${artists.disambiguation})`,
        tags: sql`COALESCE(excluded.tags, ${artists.tags})`,
        genres: sql`COALESCE(excluded.genres, ${artists.genres})`,
        imageUrl: sql`COALESCE(excluded.image_url, ${artists.imageUrl})`,
        logoUrl: sql`COALESCE(excluded.logo_url, ${artists.logoUrl})`,
        streamingUrls: sql`COALESCE(excluded.streaming_urls, ${artists.streamingUrls})`,
        beginYear: sql`COALESCE(excluded.begin_year, ${artists.beginYear})`,
        endYear: sql`COALESCE(excluded.end_year, ${artists.endYear})`,
        // Clear negative cache when image found; set it when lookup failed; preserve otherwise
        imageFailedAt: artist.imageUrl
          ? sql`NULL`
          : imageFailed
            ? sql`NOW()`
            : sql`${artists.imageFailedAt}`,
        cachedAt: new Date(),
      },
    })
    .returning()
  const row = rows[0]
  if (!row) throw new Error(`upsertArtist: no row returned for mbid=${artist.mbid}`)
  return row
}

export async function getArtistById(db: Database, id: number): Promise<ArtistRow | null> {
  const rows = await db.select().from(artists).where(eq(artists.id, id)).limit(1)
  return rows[0] ?? null
}

type GenreEnrichment = { examples: string[]; liveCount: number }

/**
 * Returns a map of genre name -> { examples, liveCount } using two efficient
 * queries: a lateral join for example names, and an aggregate for live counts.
 */
export async function getGenreEnrichments(
  db: Database,
  exampleLimit = 3,
): Promise<Map<string, GenreEnrichment>> {
  const [exRows, countRows] = await Promise.all([
    db.execute<{ genre_name: string; artist_name: string }>(
      sql`SELECT g.name AS genre_name, sub.name AS artist_name
          FROM ${genres} g
          CROSS JOIN LATERAL (
            SELECT ar.name
            FROM artists ar
            WHERE EXISTS (
              SELECT 1 FROM unnest(ar.genres) ag WHERE lower(ag) = lower(g.name)
            )
            ORDER BY ar.name
            LIMIT ${exampleLimit}
          ) sub
          WHERE g.source = 'library'`,
    ),
    db.execute<{ genre_name: string; cnt: string }>(
      sql`SELECT g.name AS genre_name, count(*)::text AS cnt
          FROM ${genres} g
          JOIN artists ar ON EXISTS (
            SELECT 1 FROM unnest(ar.genres) ag WHERE lower(ag) = lower(g.name)
          )
          WHERE g.source = 'library'
          GROUP BY g.name`,
    ),
  ])

  const result = new Map<string, GenreEnrichment>()
  const counts = countRows.rows as { genre_name: string; cnt: string }[]
  const examples = exRows.rows as { genre_name: string; artist_name: string }[]

  for (const { genre_name, cnt } of counts) {
    result.set(genre_name, { examples: [], liveCount: Number.parseInt(cnt, 10) })
  }

  for (const { genre_name, artist_name } of examples) {
    const entry = result.get(genre_name) ?? { examples: [], liveCount: 0 }
    entry.examples.push(artist_name)
    result.set(genre_name, entry)
  }

  return result
}

export async function getArtistsByGenre(
  db: Database,
  genreName: string,
  limit = 100,
): Promise<ArtistRow[]> {
  return db
    .select()
    .from(artists)
    .where(
      sql`EXISTS (SELECT 1 FROM unnest(${artists.genres}) g WHERE lower(g) = lower(${genreName}))`,
    )
    .limit(limit)
    .orderBy(artists.name)
}
