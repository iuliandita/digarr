import { and, desc, eq, gte, inArray, lt, max, sql } from 'drizzle-orm'
import type { Database } from '@/db'
import { artists, recommendations } from '@/db/schema'
import type { StrategyArtist, StrategyDeps } from './strategies/types'

const APPROVED_STATUSES = ['approved', 'added_to_lidarr']

// Filtering before LIMIT keeps a genre outside the top-scored approvals reachable.
function genreSubstring(genre: string) {
  return sql`EXISTS (SELECT 1 FROM unnest(${artists.genres}) g
    WHERE strpos(lower(g), lower(${genre})) > 0)`
}

// Same normalization as the mood-mix strategy: lowercase, '&' as 'and', other
// punctuation collapsed to single spaces.
function genreKeywordMatch(keywords: string[]) {
  return sql`EXISTS (SELECT 1 FROM unnest(${artists.genres}) g, unnest(${sql.param(keywords)}::text[]) k
    WHERE strpos(trim(regexp_replace(replace(lower(g), '&', ' and '), '[^a-z0-9]+', ' ', 'g')), k) > 0)`
}

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
          // The best-scored pending recommendation that names a recording supplies it.
          recordingMbid: sql<
            string | null
          >`(array_agg(${recommendations.recommendedRecordingMbid} ORDER BY ${recommendations.score} DESC, ${recommendations.id} DESC) FILTER (WHERE ${recommendations.recommendedRecordingMbid} IS NOT NULL))[1]`,
          recordingTitle: sql<
            string | null
          >`(array_agg(${recommendations.recommendedRecordingTitle} ORDER BY ${recommendations.score} DESC, ${recommendations.id} DESC) FILTER (WHERE ${recommendations.recommendedRecordingMbid} IS NOT NULL))[1]`,
        })
        .from(recommendations)
        .innerJoin(artists, eq(artists.id, recommendations.artistId))
        .where(and(eq(recommendations.status, 'pending'), eq(recommendations.userId, userId)))
        .groupBy(artists.id)
        .orderBy(desc(max(recommendations.score)), artists.id)
        .limit(opts.limit)

      return rows.map(({ recordingMbid, recordingTitle, ...row }) => ({
        ...row,
        score: row.score ?? 0,
        genres: row.genres ?? [],
        ...(recordingMbid
          ? { recording: { mbid: recordingMbid, title: recordingTitle ?? undefined } }
          : {}),
      }))
    },

    async getApprovedArtists(opts): Promise<StrategyArtist[]> {
      if (userId == null) return []
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
            eq(recommendations.userId, userId),
            opts.genre ? genreSubstring(opts.genre) : undefined,
            opts.genreKeywords?.length ? genreKeywordMatch(opts.genreKeywords) : undefined,
          ),
        )
        .orderBy(desc(recommendations.score))
        .limit(opts.limit ?? 200)

      return rows.map((r) => ({
        name: r.name,
        mbid: r.mbid,
        score: r.score,
        genres: r.genres ?? [],
      }))
    },

    async getOlderApprovedArtists(opts): Promise<StrategyArtist[]> {
      if (userId == null) return []
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
            eq(recommendations.userId, userId),
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
