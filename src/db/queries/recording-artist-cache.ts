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

export async function insertCachedRecordingArtists(
  db: Database,
  entries: Array<{ recordingMbid: string; artistMbid: string; artistName: string }>,
): Promise<void> {
  if (entries.length === 0) return
  await db
    .insert(recordingArtistCache)
    .values(entries)
    .onConflictDoNothing({ target: recordingArtistCache.recordingMbid })
}
