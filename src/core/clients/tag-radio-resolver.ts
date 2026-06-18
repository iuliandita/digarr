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

  // 2. Partition into hits and misses
  const misses = recordings.filter((r) => !cacheMap.has(r.recordingMbid))

  // 3. Resolve misses via MB (client handles rate limiting internally)
  const resolved: (RecordingArtistCredit | null)[] = []
  for (const r of misses) {
    try {
      resolved.push(await mbClient.lookupRecording(r.recordingMbid))
    } catch (err) {
      console.error(`[tag-radio] lookupRecording failed for ${r.recordingMbid}:`, err)
      resolved.push(null)
    }
  }

  // 4. Write newly resolved to cache
  const newEntries = resolved.filter((r): r is RecordingArtistCredit => r != null)
  await insertCachedRecordingArtists(
    db,
    newEntries.map((e) => ({
      recordingMbid: e.recordingMbid,
      artistMbid: e.artistMbid,
      artistName: e.artistName,
    })),
  )

  // 5. Build unified recording -> artist map
  const recordingToArtist = new Map<string, { artistMbid: string; artistName: string }>()
  for (const c of cached) {
    recordingToArtist.set(c.recordingMbid, {
      artistMbid: c.artistMbid,
      artistName: c.artistName,
    })
  }
  for (const e of newEntries) {
    recordingToArtist.set(e.recordingMbid, {
      artistMbid: e.artistMbid,
      artistName: e.artistName,
    })
  }

  // 6. Group by artist, take max percent
  const artistMap = new Map<string, { artistName: string; maxPercent: number }>()
  for (const rec of recordings) {
    const artist = recordingToArtist.get(rec.recordingMbid)
    if (!artist) continue
    const existing = artistMap.get(artist.artistMbid)
    if (!existing || rec.percent > existing.maxPercent) {
      artistMap.set(artist.artistMbid, {
        artistName: artist.artistName,
        maxPercent: rec.percent,
      })
    }
  }

  // 7. Return sorted by score descending
  return Array.from(artistMap.entries())
    .map(([artistMbid, { artistName, maxPercent }]) => ({
      artistMbid,
      artistName,
      score: maxPercent / 100,
    }))
    .sort((a, b) => b.score - a.score)
}
