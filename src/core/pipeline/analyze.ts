import type { DiscoverySource, ListeningActivityEntry, TopArtistEntry } from '@/core/plugins/types'
import type { TasteProfile } from '@/core/types'

export async function analyze(sources: DiscoverySource[]): Promise<TasteProfile> {
  // One failing source must not crash the whole pipeline run.
  const results = await Promise.allSettled(
    sources.map(async (source) => ({
      id: source.id,
      artists: await source.getTopArtists(),
      activity: source.getListeningActivity ? await source.getListeningActivity() : [],
    })),
  )

  const allArtists: TopArtistEntry[] = []
  let activityData: ListeningActivityEntry[] = []

  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    if (r?.status !== 'fulfilled') {
      const sourceId = sources[i]?.id ?? 'unknown'
      const reason = r && r.status === 'rejected' ? r.reason : 'unknown'
      const msg = reason instanceof Error ? reason.message : String(reason)
      console.warn(`[analyze] source ${sourceId} failed: ${msg}`)
      continue
    }
    for (const a of r.value.artists) allArtists.push(a)
    // Deterministic: first fulfilled source with activity wins.
    if (activityData.length === 0 && r.value.activity.length > 0) {
      activityData = r.value.activity
    }
  }

  // Deduplicate by name (case-insensitive), keep highest play count
  const byName = new Map<string, TopArtistEntry>()
  for (const artist of allArtists) {
    const key = artist.name.toLowerCase()
    const existing = byName.get(key)
    if (existing === undefined || artist.playCount > existing.playCount) {
      byName.set(key, artist)
    }
  }

  const topArtists = Array.from(byName.values()).sort((a, b) => b.playCount - a.playCount)

  // Genre extraction from listening data is not yet implemented.
  // Library genre overlap (the main genre scoring path) works via the
  // orchestrator passing libraryGenres from Lidarr to score().
  const topGenres: Array<{ name: string; weight: number }> = []

  // Determine recentTrend from listening activity
  const recentTrend = computeRecentTrend(activityData)

  const totalListens = activityData.reduce((sum, e) => sum + e.listen_count, 0)

  return {
    topArtists: topArtists.map((a) => ({
      name: a.name,
      mbid: a.mbid,
      playCount: a.playCount,
      source: a.source,
    })),
    topGenres,
    listeningPatterns: {
      totalListens,
      recentTrend,
    },
  }
}

function computeRecentTrend(
  activity: ListeningActivityEntry[],
): 'increasing' | 'stable' | 'decreasing' {
  if (activity.length < 2) return 'stable'

  // Compare last two periods
  const sorted = [...activity].sort((a, b) => a.from_ts - b.from_ts)
  const prev = sorted[sorted.length - 2]
  const last = sorted[sorted.length - 1]

  if (prev === undefined || last === undefined) return 'stable'

  const ratio = prev.listen_count > 0 ? last.listen_count / prev.listen_count : 1

  if (ratio > 1.1) return 'increasing'
  if (ratio < 0.9) return 'decreasing'
  return 'stable'
}
