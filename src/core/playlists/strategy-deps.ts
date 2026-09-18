import { and, desc, eq, gte, inArray, lt, max } from 'drizzle-orm'
import type { Database } from '@/db'
import { artists, recommendations } from '@/db/schema'
import type { StrategyArtist, StrategyDeps } from './strategies/types'

const APPROVED_STATUSES = ['approved', 'added_to_lidarr']

export function buildStrategyDeps(db: Database, userId: number | null): StrategyDeps {
  return {
    async getPendingArtists(opts): Promise<StrategyArtist[]> {
      if (userId == null) return []
      const rows = await db
        .select({
          name: artists.name,
          mbid: artists.mbid,
          score: max(recommendations.score),
          genres: artists.genres,
        })
        .from(recommendations)
        .innerJoin(artists, eq(artists.id, recommendations.artistId))
        .where(and(eq(recommendations.status, 'pending'), eq(recommendations.userId, userId)))
        .groupBy(artists.id)
        .orderBy(desc(max(recommendations.score)), artists.id)
        .limit(opts.limit)

      return rows.map((row) => ({ ...row, score: row.score ?? 0, genres: row.genres ?? [] }))
    },

    async getApprovedArtists(opts): Promise<StrategyArtist[]> {
      const rows = await db
        .select({
          name: artists.name,
          mbid: artists.mbid,
          score: recommendations.score,
          genres: artists.genres,
        })
        .from(recommendations)
        .innerJoin(artists, eq(artists.id, recommendations.artistId))
        .where(
          and(
            inArray(recommendations.status, APPROVED_STATUSES),
            opts.since ? gte(recommendations.actedOnAt, opts.since) : undefined,
            userId != null ? eq(recommendations.userId, userId) : undefined,
          ),
        )
        .orderBy(desc(recommendations.score))
        .limit(opts.limit ?? 200)

      let result: StrategyArtist[] = rows.map((r) => ({
        name: r.name,
        mbid: r.mbid,
        score: r.score,
        genres: r.genres ?? [],
      }))

      if (opts.genre) {
        const g = opts.genre.toLowerCase()
        result = result.filter((a) => a.genres?.some((genre) => genre.toLowerCase().includes(g)))
      }

      return result
    },

    async getOlderApprovedArtists(opts): Promise<StrategyArtist[]> {
      const rows = await db
        .select({
          name: artists.name,
          mbid: artists.mbid,
          score: recommendations.score,
          genres: artists.genres,
        })
        .from(recommendations)
        .innerJoin(artists, eq(artists.id, recommendations.artistId))
        .where(
          and(
            inArray(recommendations.status, APPROVED_STATUSES),
            lt(recommendations.actedOnAt, opts.olderThan),
            userId != null ? eq(recommendations.userId, userId) : undefined,
          ),
        )
        .orderBy(desc(recommendations.score))
        .limit(opts.limit)

      return rows.map((r) => ({
        name: r.name,
        mbid: r.mbid,
        score: r.score,
        genres: r.genres ?? [],
      }))
    },
  }
}
