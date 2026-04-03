import { and, count, desc, eq, gte, inArray, sql } from 'drizzle-orm'
import type { Database } from '@/db'
import { artistMetadata, artists, recommendationBatches, recommendations } from '@/db/schema'

type RecommendationRow = typeof recommendations.$inferSelect
type ArtistRow = typeof artists.$inferSelect

export type RecommendationWithArtist = RecommendationRow & { artist: ArtistRow }

const DECADE_RANGES: Record<string, [number, number]> = {
  '60s': [1960, 1969],
  '70s': [1970, 1979],
  '80s': [1980, 1989],
  '90s': [1990, 1999],
  '00s': [2000, 2009],
  '10s': [2010, 2019],
  '20s+': [2020, 2099],
}

export function parseDecades(raw: string): Array<[number, number]> {
  return raw
    .split(',')
    .map((d) => DECADE_RANGES[d.trim()])
    .filter((v): v is [number, number] => v != null)
}

export type ListRecommendationsFilters = {
  status?: string
  batchId?: number
  userId?: number
  decades?: string
  sort?: 'score_desc' | 'score_asc' | 'created_desc' | 'acted_on_desc'
  limit?: number
  offset?: number
}

export type ListRecommendationsResult = {
  items: RecommendationWithArtist[]
  total: number
}

export async function listRecommendations(
  db: Database,
  filters: ListRecommendationsFilters = {},
): Promise<ListRecommendationsResult> {
  const { status, batchId, userId, decades, sort = 'score_desc', limit = 20, offset = 0 } = filters

  const conditions = []
  if (status !== undefined) {
    if (status.includes(',')) {
      conditions.push(inArray(recommendations.status, status.split(',')))
    } else {
      conditions.push(eq(recommendations.status, status))
    }
  }
  if (batchId !== undefined) conditions.push(eq(recommendations.batchId, batchId))
  if (userId !== undefined) conditions.push(eq(recommendations.userId, userId))

  if (decades) {
    const ranges = parseDecades(decades)
    if (ranges.length > 0) {
      const orClauses = ranges.map(
        ([min, max]) => sql`(${artists.beginYear} >= ${min} AND ${artists.beginYear} <= ${max})`,
      )
      conditions.push(sql`(${sql.join(orClauses, sql` OR `)})`)
    }
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined

  const orderBy =
    sort === 'score_asc'
      ? recommendations.score
      : sort === 'created_desc'
        ? desc(recommendations.createdAt)
        : sort === 'acted_on_desc'
          ? desc(recommendations.actedOnAt)
          : desc(recommendations.score)

  const [rows, countRows] = await Promise.all([
    db
      .select({
        recommendation: recommendations,
        artist: artists,
      })
      .from(recommendations)
      .innerJoin(artists, eq(recommendations.artistId, artists.id))
      .where(where)
      .orderBy(orderBy)
      .limit(limit)
      .offset(offset),
    decades
      ? db
          .select({ total: count() })
          .from(recommendations)
          .innerJoin(artists, eq(recommendations.artistId, artists.id))
          .where(where)
      : db.select({ total: count() }).from(recommendations).where(where),
  ])

  const items = rows.map((r) => ({ ...r.recommendation, artist: r.artist }))
  const total = countRows[0]?.total ?? 0

  return { items, total }
}

export async function getRecommendation(
  db: Database,
  id: number,
): Promise<RecommendationWithArtist | null> {
  const rows = await db
    .select({ recommendation: recommendations, artist: artists })
    .from(recommendations)
    .innerJoin(artists, eq(recommendations.artistId, artists.id))
    .where(eq(recommendations.id, id))
    .limit(1)

  const row = rows[0]
  if (!row) return null
  return { ...row.recommendation, artist: row.artist }
}

export type StatusUpdateExtra = {
  lidarrArtistId?: number
  lidarrError?: string
  targetActions?: Record<string, unknown>
}

export async function updateRecommendationStatus(
  db: Database,
  id: number,
  status: string,
  extra: StatusUpdateExtra = {},
): Promise<void> {
  await db
    .update(recommendations)
    .set({ status, actedOnAt: new Date(), ...extra })
    .where(eq(recommendations.id, id))
}

export async function bulkUpdateStatus(db: Database, ids: number[], status: string): Promise<void> {
  if (ids.length === 0) return
  await db
    .update(recommendations)
    .set({ status, actedOnAt: new Date() })
    .where(inArray(recommendations.id, ids))
}

export async function getGenreFeedbackHistory(
  db: Database,
): Promise<Map<string, { approved: number; total: number }>> {
  // Query all acted-upon recommendations joined with artists
  const rows = await db
    .select({
      genres: artists.genres,
      status: recommendations.status,
    })
    .from(recommendations)
    .innerJoin(artists, eq(recommendations.artistId, artists.id))
    .where(sql`${recommendations.actedOnAt} is not null`)

  const genreMap = new Map<string, { approved: number; total: number }>()

  for (const row of rows) {
    if (!row.genres) continue
    for (const genre of row.genres) {
      const entry = genreMap.get(genre) ?? { approved: 0, total: 0 }
      entry.total += 1
      if (row.status === 'approved' || row.status === 'added_to_lidarr') entry.approved += 1
      genreMap.set(genre, entry)
    }
  }

  return genreMap
}

export async function filterOwnedIds(
  db: Database,
  ids: number[],
  userId: number | undefined,
): Promise<number[]> {
  if (ids.length === 0) return []

  const conditions = [inArray(recommendations.id, ids)]
  if (userId !== undefined) {
    conditions.push(
      sql`(${recommendations.userId} IS NULL OR ${recommendations.userId} = ${userId})`,
    )
  }

  const rows = await db
    .select({ id: recommendations.id })
    .from(recommendations)
    .where(and(...conditions))

  return rows.map((r) => r.id)
}

export async function getRejectedArtistMbids(
  db: Database,
  cooldownDays: number,
): Promise<Set<string>> {
  const cutoff = new Date(Date.now() - cooldownDays * 24 * 60 * 60 * 1000)

  const rows = await db
    .select({ mbid: artists.mbid })
    .from(recommendations)
    .innerJoin(artists, eq(recommendations.artistId, artists.id))
    .where(and(eq(recommendations.status, 'rejected'), gte(recommendations.actedOnAt, cutoff)))

  return new Set(rows.map((r) => r.mbid))
}

export type GenreArtistResult = {
  name: string
  mbid: string
  imageUrl: string | null
  score: number
  genres: string[] | null
  aiReasoning: string | null
  streamingUrls: Record<string, string> | null
}

export type GenreArtistView = 'recommended' | 'trending' | 'deep_cuts'

/**
 * Returns artists from the recommendations table for a given genre, scoped by view:
 *  - recommended: approved/added artists sorted by score desc
 *  - trending: any status, batches from last 30 days, sorted by score desc
 *  - deep_cuts: pending artists with low spotify popularity or few genre tags
 */
export async function getGenreArtists(
  db: Database,
  genreName: string,
  view: GenreArtistView,
  limit = 20,
  userId?: number,
): Promise<GenreArtistResult[]> {
  const genreCondition = sql`EXISTS (
    SELECT 1 FROM unnest(${artists.genres}) g WHERE lower(g) = lower(${genreName})
  )`

  if (view === 'recommended') {
    const userCondition = userId ? eq(recommendations.userId, userId) : sql`TRUE`
    const rows = await db
      .select({
        name: artists.name,
        mbid: artists.mbid,
        imageUrl: artists.imageUrl,
        score: recommendations.score,
        genres: artists.genres,
        aiReasoning: recommendations.aiReasoning,
        streamingUrls: artists.streamingUrls,
      })
      .from(recommendations)
      .innerJoin(artists, eq(recommendations.artistId, artists.id))
      .where(
        and(
          genreCondition,
          inArray(recommendations.status, ['approved', 'added_to_lidarr']),
          userCondition,
        ),
      )
      .orderBy(desc(recommendations.score))
      .limit(limit)
    return rows
  }

  if (view === 'trending') {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const rows = await db
      .select({
        name: artists.name,
        mbid: artists.mbid,
        imageUrl: artists.imageUrl,
        score: recommendations.score,
        genres: artists.genres,
        aiReasoning: recommendations.aiReasoning,
        streamingUrls: artists.streamingUrls,
      })
      .from(recommendations)
      .innerJoin(artists, eq(recommendations.artistId, artists.id))
      .innerJoin(recommendationBatches, eq(recommendations.batchId, recommendationBatches.id))
      .where(and(genreCondition, gte(recommendationBatches.createdAt, cutoff)))
      .orderBy(desc(recommendations.score))
      .limit(limit)
    return rows
  }

  // deep_cuts: pending recs with either low spotify popularity or few genre tags
  const rows = await db
    .select({
      name: artists.name,
      mbid: artists.mbid,
      imageUrl: artists.imageUrl,
      score: recommendations.score,
      genres: artists.genres,
      aiReasoning: recommendations.aiReasoning,
      streamingUrls: artists.streamingUrls,
      spotifyPopularity: artistMetadata.spotifyPopularity,
    })
    .from(recommendations)
    .innerJoin(artists, eq(recommendations.artistId, artists.id))
    .leftJoin(artistMetadata, sql`lower(${artistMetadata.nameNormalized}) = lower(${artists.name})`)
    .where(
      and(
        genreCondition,
        eq(recommendations.status, 'pending'),
        sql`(
          ${artistMetadata.spotifyPopularity} IS NULL
          OR ${artistMetadata.spotifyPopularity} < 30
          OR array_length(${artists.genres}, 1) <= 3
        )`,
      ),
    )
    .orderBy(desc(recommendations.score))
    .limit(limit)

  return rows.map(({ spotifyPopularity: _sp, ...r }) => r)
}

export async function insertRecommendation(
  db: Database,
  data: {
    artistId: number
    batchId: number
    score: number
    sources: Record<string, number>
    aiReasoning?: string
    status: string
    userId?: number
    recommendedReleaseGroupId?: string
    recommendedReleaseGroupTitle?: string
  },
): Promise<void> {
  await db.insert(recommendations).values({
    artistId: data.artistId,
    batchId: data.batchId,
    score: data.score,
    sources: data.sources,
    aiReasoning: data.aiReasoning,
    status: data.status,
    userId: data.userId,
    recommendedReleaseGroupId: data.recommendedReleaseGroupId,
    recommendedReleaseGroupTitle: data.recommendedReleaseGroupTitle,
  })
}
