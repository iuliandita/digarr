import { desc, eq, ilike, isNull } from 'drizzle-orm'
import type { Database } from '@/db'
import { genres } from '@/db/schema'

type GenreRow = typeof genres.$inferSelect

export type GenreInsert = {
  name: string
  slug: string
  source: string
  parentGenreId?: number | null
  artistCount?: number | null
  cachedAt?: Date | null
}

export async function upsertGenre(db: Database, data: GenreInsert): Promise<GenreRow> {
  const rows = await db
    .insert(genres)
    .values(data)
    .onConflictDoUpdate({
      target: genres.slug,
      set: {
        name: data.name,
        source: data.source,
        artistCount: data.artistCount ?? 0,
        cachedAt: data.cachedAt !== undefined ? data.cachedAt : new Date(),
      },
    })
    .returning()
  const row = rows[0]
  if (!row) throw new Error(`upsertGenre: no row returned for slug=${data.slug}`)
  return row
}

export async function getGenreBySlug(db: Database, slug: string): Promise<GenreRow | null> {
  const rows = await db.select().from(genres).where(eq(genres.slug, slug)).limit(1)
  return rows[0] ?? null
}

export async function getChildGenres(db: Database, parentId: number): Promise<GenreRow[]> {
  return db.select().from(genres).where(eq(genres.parentGenreId, parentId))
}

export async function searchGenres(db: Database, query: string, limit = 20): Promise<GenreRow[]> {
  const escaped = query.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
  return db
    .select()
    .from(genres)
    .where(ilike(genres.name, `%${escaped}%`))
    .limit(limit)
}

export async function getAllGenres(db: Database): Promise<GenreRow[]> {
  return db.select().from(genres).orderBy(desc(genres.artistCount))
}

export async function getRootGenres(db: Database): Promise<GenreRow[]> {
  return db.select().from(genres).where(isNull(genres.parentGenreId))
}
