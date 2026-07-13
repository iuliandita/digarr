import type { DiscoverySource, ListeningActivityEntry, TopArtistEntry } from '@/core/plugins/types'
import type { GenreCoverage, GenreSource, TasteProfile } from '@/core/types'
import { isValidMbid } from '@/core/validation'

export type AnalyzeOptions = {
  genreHydrator?: (
    artists: TopArtistEntry[],
  ) => Promise<{ artists: TopArtistEntry[]; coverage: GenreCoverage }>
}

function preferredGenreSource(
  first: GenreSource | undefined,
  second: GenreSource | undefined,
): GenreSource | undefined {
  const priority: GenreSource[] = ['native', 'library', 'artist-cache']
  return priority.find((source) => source === first || source === second)
}

function mergeGenres(...genreLists: Array<string[] | undefined>): string[] {
  const genres = new Map<string, string>()
  for (const genre of genreLists.flatMap((list) => list ?? [])) {
    const trimmed = genre.trim()
    if (trimmed) genres.set(trimmed.toLowerCase(), genres.get(trimmed.toLowerCase()) ?? trimmed)
  }
  return [...genres.values()]
}

function mergeArtistEntries(first: TopArtistEntry, second: TopArtistEntry): TopArtistEntry {
  const primary = second.playCount > first.playCount ? second : first
  const secondary = primary === second ? first : second
  const genres = mergeGenres(primary.genres, secondary.genres)
  return {
    ...primary,
    mbid: isValidMbid(primary.mbid)
      ? primary.mbid
      : isValidMbid(secondary.mbid)
        ? secondary.mbid
        : undefined,
    ...(genres.length > 0 ? { genres } : {}),
    genreSource: preferredGenreSource(primary.genreSource, secondary.genreSource),
  }
}

export async function analyze(
  sources: DiscoverySource[],
  options: AnalyzeOptions = {},
): Promise<TasteProfile> {
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

  const byMbid = new Map<string, TopArtistEntry>()
  const withoutMbid: TopArtistEntry[] = []
  for (const artist of allArtists) {
    const mbid = isValidMbid(artist.mbid) ? artist.mbid.toLowerCase() : undefined
    if (!mbid) withoutMbid.push({ ...artist, mbid: undefined })
    else byMbid.set(mbid, mergeArtistEntries(byMbid.get(mbid) ?? artist, artist))
  }

  const byName = new Map<string, TopArtistEntry[]>()
  for (const artist of [...byMbid.values(), ...withoutMbid]) {
    const key = artist.name.trim().toLowerCase()
    const matches = byName.get(key) ?? []
    matches.push(artist)
    byName.set(key, matches)
  }

  const dedupedArtists = [...byName.values()]
    .flatMap((matches) => {
      const mbids = new Set(
        matches
          .map((artist) => (isValidMbid(artist.mbid) ? artist.mbid.toLowerCase() : undefined))
          .filter(Boolean),
      )
      return mbids.size <= 1
        ? [matches.reduce((merged, artist) => mergeArtistEntries(merged, artist))]
        : matches
    })
    .sort((a, b) => b.playCount - a.playCount)
  const genreResult = options.genreHydrator
    ? await options.genreHydrator(dedupedArtists)
    : {
        artists: dedupedArtists,
        coverage: {
          coveredArtists: dedupedArtists.filter((artist) => (artist.genres?.length ?? 0) > 0)
            .length,
          pendingArtists: dedupedArtists.filter((artist) => (artist.genres?.length ?? 0) === 0)
            .length,
          totalArtists: dedupedArtists.length,
        },
      }
  const topArtists = genreResult.artists

  // Aggregate genres from listening sources that carry them (e.g. Spotify).
  // Weight each genre by the sum of playCount of artists that carry it, then
  // normalize so the highest-weight genre is 1.0. Artists with no genres are
  // skipped. Genres are lowercased to match score()'s libraryGenreSet.
  const genreWeights = new Map<string, number>()
  for (const artist of topArtists) {
    if (!artist.genres || artist.genres.length === 0) continue
    for (const key of new Set(
      artist.genres.map((genre) => genre.trim().toLowerCase()).filter(Boolean),
    )) {
      genreWeights.set(key, (genreWeights.get(key) ?? 0) + artist.playCount)
    }
  }
  const maxWeight = genreWeights.size > 0 ? Math.max(...genreWeights.values()) : 0
  const topGenres: Array<{ name: string; weight: number }> =
    maxWeight > 0
      ? [...genreWeights.entries()]
          .map(([name, weight]) => ({ name, weight: weight / maxWeight }))
          .sort((a, b) => b.weight - a.weight)
      : []

  // Determine recentTrend from listening activity
  const recentTrend = computeRecentTrend(activityData)

  const totalListens = activityData.reduce((sum, e) => sum + e.listen_count, 0)

  return {
    topArtists: topArtists.map((a) => ({
      name: a.name,
      mbid: a.mbid,
      playCount: a.playCount,
      source: a.source,
      genres: a.genres,
      genreSource: a.genreSource,
    })),
    topGenres,
    genreCoverage: genreResult.coverage,
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
