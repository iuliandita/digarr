import { inArray } from 'drizzle-orm'
import type { Database } from '@/db'
import { recordingArtistCache } from '@/db/schema'

export type CachedRecordingArtist = typeof recordingArtistCache.$inferSelect

export async function getCachedRecordingArtists(
  db: Database,
  recordingMbids: string[],
): Promise<CachedRecordingArtist[]> {
  if (recordingMbids.length === 0) return []
  return db
    .select()
    .from(recordingArtistCache)
    .where(inArray(recordingArtistCache.recordingMbid, recordingMbids))
}

// Postgres bind-parameter limit is 65535; 3 cols per row -> floor(65535/3)=21845.
// 5000 is safe headroom and also limits transaction size.
const CACHE_INSERT_CHUNK = 5000

export async function insertCachedRecordingArtists(
  db: Database,
  entries: Array<{ recordingMbid: string; artistMbid: string; artistName: string }>,
): Promise<void> {
  if (entries.length === 0) return
  for (let i = 0; i < entries.length; i += CACHE_INSERT_CHUNK) {
    await db
      .insert(recordingArtistCache)
      .values(entries.slice(i, i + CACHE_INSERT_CHUNK))
      .onConflictDoNothing({ target: recordingArtistCache.recordingMbid })
  }
}
