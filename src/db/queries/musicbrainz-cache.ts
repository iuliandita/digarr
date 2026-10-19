import { and, eq, gt, lt, sql } from 'drizzle-orm'
import {
  MUSICBRAINZ_CACHE_TTL_MS,
  MUSICBRAINZ_NOT_FOUND_TTL_MS,
  type MusicBrainzCacheEntry,
  type MusicBrainzCacheStore,
} from '@/core/clients/musicbrainz-cache'
import type { Database } from '@/db'
import { musicbrainzCache } from '@/db/schema'

const PRUNE_INTERVAL_MS = 60 * 60 * 1000

export function createMusicBrainzCacheStore(
  db: Database,
  { now = Date.now }: { now?: () => number } = {},
): MusicBrainzCacheStore & { prune(): Promise<void> } {
  let lastPruneAt = 0

  async function prune(): Promise<void> {
    await db.delete(musicbrainzCache).where(lt(musicbrainzCache.expiresAt, new Date(now())))
  }

  return {
    async get(key) {
      const [row] = await db
        .select({ status: musicbrainzCache.status, body: musicbrainzCache.body })
        .from(musicbrainzCache)
        .where(and(eq(musicbrainzCache.key, key), gt(musicbrainzCache.expiresAt, new Date(now()))))
        .limit(1)
      if (!row) return null
      if (row.status === 404) return { status: 404, body: null }
      if (row.status === 200) return { status: 200, body: row.body }
      return null
    },

    async set(key, kind, entry: MusicBrainzCacheEntry) {
      const fetchedAt = new Date(now())
      const ttl =
        entry.status === 404 ? MUSICBRAINZ_NOT_FOUND_TTL_MS : MUSICBRAINZ_CACHE_TTL_MS[kind]
      const expiresAt = new Date(fetchedAt.getTime() + ttl)
      await db
        .insert(musicbrainzCache)
        .values({ key, kind, status: entry.status, body: entry.body, fetchedAt, expiresAt })
        .onConflictDoUpdate({
          target: musicbrainzCache.key,
          set: {
            kind: sql`excluded.kind`,
            status: sql`excluded.status`,
            body: sql`excluded.body`,
            fetchedAt: sql`excluded.fetched_at`,
            expiresAt: sql`excluded.expires_at`,
          },
        })
      // Opportunistic pruning keeps the table bounded without another scheduler.
      if (fetchedAt.getTime() - lastPruneAt >= PRUNE_INTERVAL_MS) {
        lastPruneAt = fetchedAt.getTime()
        await prune()
      }
    },

    prune,
  }
}
