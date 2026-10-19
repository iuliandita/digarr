import type { TagRadioRecording } from '@/core/clients/listenbrainz'
import type { RecordingArtistCredit } from '@/core/clients/musicbrainz'
import type { Database } from '@/db'
import {
  getCachedRecordingArtists,
  insertCachedRecordingArtists,
} from '@/db/queries/recording-artist-cache'

export type ResolvedTagArtist = {
  artistMbid: string
  artistName: string
  score: number
  /** The radio recording that earned this artist its score. */
  recordingMbid: string
  recordingTitle?: string
}

type MbClientForTagRadio = {
  lookupRecording(mbid: string): Promise<RecordingArtistCredit | null>
}

export async function resolveTagRadioRecordings(
  recordings: TagRadioRecording[],
  mbClient: MbClientForTagRadio,
  db: Database,
): Promise<ResolvedTagArtist[]> {
  if (recordings.length === 0) return []

  // 1. Batch cache lookup
  const allMbids = recordings.map((r) => r.recordingMbid)
  const cached = await getCachedRecordingArtists(db, allMbids)
  const cacheMap = new Map(cached.map((c) => [c.recordingMbid, c]))

  // 2. Partition into hits and misses. Rows cached before titles were stored (null) are
  // looked up once; a successful lookup always writes a title or '' so it is not refetched.
  const misses = recordings.filter((r) => cacheMap.get(r.recordingMbid)?.recordingTitle == null)

  // 3. Resolve misses via MB (client handles rate limiting internally)
  const resolved: (RecordingArtistCredit | null)[] = []
  for (const r of misses) {
    try {
      const credit = await mbClient.lookupRecording(r.recordingMbid)
      const stale = cacheMap.get(r.recordingMbid)
      // Gone from MB: mark the old row as looked up instead of refetching it every run.
      resolved.push(credit ?? (stale ? { ...stale, title: '' } : null))
    } catch (err) {
      console.error(`[tag-radio] lookupRecording failed for ${r.recordingMbid}:`, err)
      resolved.push(null)
    }
  }

  // 4. Write newly resolved to cache
  const newEntries = resolved.filter((r): r is RecordingArtistCredit => r != null)
  try {
    await insertCachedRecordingArtists(
      db,
      newEntries.map((e) => ({
        recordingMbid: e.recordingMbid,
        artistMbid: e.artistMbid,
        artistName: e.artistName,
        recordingTitle: e.title ?? '',
      })),
    )
  } catch (err) {
    // A failed cache write must not discard artists already resolved this run.
    console.error('[tag-radio] recording cache insert failed:', err)
  }

  // 5. Build unified recording -> artist map
  const recordingToArtist = new Map<
    string,
    { artistMbid: string; artistName: string; title?: string }
  >()
  for (const c of cached) {
    recordingToArtist.set(c.recordingMbid, {
      artistMbid: c.artistMbid,
      artistName: c.artistName,
      title: c.recordingTitle || undefined,
    })
  }
  for (const e of newEntries) {
    recordingToArtist.set(e.recordingMbid, {
      artistMbid: e.artistMbid,
      artistName: e.artistName,
      title: e.title || undefined,
    })
  }

  // 6. Group by artist, take max percent and keep that recording
  const artistMap = new Map<
    string,
    { artistName: string; maxPercent: number; recordingMbid: string; recordingTitle?: string }
  >()
  for (const rec of recordings) {
    const artist = recordingToArtist.get(rec.recordingMbid)
    if (!artist) continue
    const existing = artistMap.get(artist.artistMbid)
    if (!existing || rec.percent > existing.maxPercent) {
      artistMap.set(artist.artistMbid, {
        artistName: artist.artistName,
        maxPercent: rec.percent,
        recordingMbid: rec.recordingMbid,
        recordingTitle: artist.title,
      })
    }
  }

  // 7. Return sorted by score descending
  return Array.from(artistMap.entries())
    .map(([artistMbid, { artistName, maxPercent, recordingMbid, recordingTitle }]) => ({
      artistMbid,
      artistName,
      score: maxPercent / 100,
      recordingMbid,
      recordingTitle,
    }))
    .sort((a, b) => b.score - a.score)
}
