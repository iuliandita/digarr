import PQueue from 'p-queue'
import type { SuggestedRecording } from '@/core/types'
import type {
  LocalTrack,
  MBRecording,
  PlaylistArtistOutcome,
  ResolvedTrack,
  TrackResolverConfig,
  TrackResolverDeps,
} from './types'

function normalizeArtist(name: string): string {
  return name.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase()
}

const DEFAULT_CONFIG: TrackResolverConfig = {
  tracksPerArtist: 3,
  sourcePriority: ['local', 'spotify'],
}

async function resolveFromLocal(
  artistName: string,
  search: (artist: string) => Promise<LocalTrack[]>,
  limit: number,
): Promise<ResolvedTrack[]> {
  const tracks = await search(artistName)
  return tracks
    .filter(
      (t) =>
        t.name.trim().length > 0 &&
        t.path.trim().length > 0 &&
        normalizeArtist(t.artist) === normalizeArtist(artistName),
    )
    .slice(0, limit)
    .map((t) => ({
      artistName,
      trackName: t.name,
      localPath: t.path,
      source: 'local' as const,
    }))
}

async function resolveFromSpotify(
  artistName: string,
  deps: TrackResolverDeps,
  limit: number,
): Promise<ResolvedTrack[]> {
  if (!deps.spotifySearch) return []

  const results = await deps.spotifySearch(`artist:${artistName}`, limit)
  return results
    .filter((t) =>
      t.artists.some((artist) => normalizeArtist(artist) === normalizeArtist(artistName)),
    )
    .sort((a, b) => b.popularity - a.popularity)
    .slice(0, limit)
    .map((t) => ({
      artistName,
      trackName: t.name,
      spotifyUri: t.uri,
      source: 'spotify' as const,
    }))
}

async function resolveFromDeezer(
  artistName: string,
  deps: TrackResolverDeps,
  limit: number,
): Promise<ResolvedTrack[]> {
  if (!deps.deezerSearch) return []

  const results = await deps.deezerSearch(`artist:"${artistName}"`, limit)
  return results
    .filter((t) =>
      t.artists.some((artist) => normalizeArtist(artist) === normalizeArtist(artistName)),
    )
    .sort((a, b) => b.rank - a.rank)
    .slice(0, limit)
    .map((t) => ({
      artistName,
      trackName: t.name,
      deezerId: t.id,
      source: 'deezer' as const,
    }))
}

async function resolveFromMusicBrainz(
  artistName: string,
  artistMbid: string,
  deps: TrackResolverDeps,
  limit: number,
): Promise<ResolvedTrack[]> {
  if (!deps.musicbrainzRecordings) return []

  const recordings = await deps.musicbrainzRecordings(artistMbid)
  return recordings.slice(0, limit).map((r: MBRecording) => ({
    artistName,
    trackName: r.title,
    mbid: r.id,
    source: 'musicbrainz' as const,
  }))
}

function normalizeTitle(title: string): string {
  return title.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase()
}

// Exact artist + title only: a remaster or another song by the artist stays unresolved.
function isSameRecording(
  candidate: { title: string; artists: string[] },
  artistName: string,
  title: string,
): boolean {
  return (
    normalizeTitle(candidate.title) === normalizeTitle(title) &&
    candidate.artists.some((artist) => normalizeArtist(artist) === normalizeArtist(artistName))
  )
}

// Spotify field filters cannot escape a double quote, so drop it from the phrase.
function spotifyPhrase(value: string): string {
  return value.replace(/"/g, ' ').replace(/\s+/g, ' ').trim()
}

function recordingSearches(
  artistName: string,
  recording: SuggestedRecording,
  deps: TrackResolverDeps,
  sourcePriority: TrackResolverConfig['sourcePriority'],
): { source: string; resolve: () => Promise<ResolvedTrack[]> }[] {
  const title = recording.title?.trim()
  if (!title) return []
  const base = { artistName, trackName: title, mbid: recording.mbid }
  const searches: { source: string; resolve: () => Promise<ResolvedTrack[]> }[] = []
  for (const source of sourcePriority) {
    if (source === 'local') {
      for (const search of [
        deps.jellyfinSearch,
        deps.embySearch,
        deps.navidromeSearch,
        deps.plexSearch,
      ]) {
        if (!search) continue
        searches.push({
          source,
          resolve: async () => {
            const match = (await search(artistName)).find(
              (t) =>
                t.path.trim() &&
                isSameRecording({ title: t.name, artists: [t.artist] }, artistName, title),
            )
            return match ? [{ ...base, localPath: match.path, source: 'local' as const }] : []
          },
        })
      }
    } else if (source === 'spotify' && deps.spotifySearch) {
      const spotifySearch = deps.spotifySearch
      searches.push({
        source,
        resolve: async () => {
          const results = await spotifySearch(
            `artist:"${spotifyPhrase(artistName)}" track:"${spotifyPhrase(title)}"`,
            10,
          )
          const match = results.find((t) =>
            isSameRecording({ title: t.name, artists: t.artists }, artistName, title),
          )
          return match ? [{ ...base, spotifyUri: match.uri, source: 'spotify' as const }] : []
        },
      })
    } else if (source === 'deezer' && deps.deezerSearch) {
      const deezerSearch = deps.deezerSearch
      searches.push({
        source,
        resolve: async () => {
          // Plain query: Deezer ignores field filters; exact matching happens below.
          const results = await deezerSearch(`${artistName} ${title}`, 10)
          const match = results.find((t) =>
            isSameRecording({ title: t.name, artists: t.artists }, artistName, title),
          )
          return match ? [{ ...base, deezerId: match.id, source: 'deezer' as const }] : []
        },
      })
    }
  }
  // The stored recording is already a MusicBrainz identity; no lookup needed.
  searches.push({
    source: 'musicbrainz',
    resolve: async () => [{ ...base, source: 'musicbrainz' as const }],
  })
  return searches
}

export type ArtistTrackResolution = {
  tracks: ResolvedTrack[]
  outcome: PlaylistArtistOutcome
}

export async function resolveTracksForArtistDetailed(
  artistName: string,
  artistMbid: string | undefined,
  deps: TrackResolverDeps,
  config: TrackResolverConfig,
  recording?: SuggestedRecording,
): Promise<ArtistTrackResolution> {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  let attempted = false
  let failed = false
  // A titled recording is never swapped for another song by the same artist. Without a
  // title it cannot be matched, so the artist resolves the usual way.
  const pinned = recording?.title?.trim() ? recording : undefined
  const searches: { source: string; resolve: () => Promise<ResolvedTrack[]> }[] = pinned
    ? recordingSearches(artistName, pinned, deps, cfg.sourcePriority)
    : []

  for (const source of pinned ? [] : cfg.sourcePriority) {
    if (source === 'local') {
      for (const search of [
        deps.jellyfinSearch,
        deps.embySearch,
        deps.navidromeSearch,
        deps.plexSearch,
      ]) {
        if (search)
          searches.push({
            source,
            resolve: () => resolveFromLocal(artistName, search, cfg.tracksPerArtist),
          })
      }
    } else if (source === 'spotify' && deps.spotifySearch) {
      searches.push({
        source,
        resolve: () => resolveFromSpotify(artistName, deps, cfg.tracksPerArtist),
      })
    } else if (source === 'deezer' && deps.deezerSearch) {
      searches.push({
        source,
        resolve: () => resolveFromDeezer(artistName, deps, cfg.tracksPerArtist),
      })
    }
  }
  if (!pinned && artistMbid && deps.musicbrainzRecordings) {
    searches.push({
      source: 'musicbrainz',
      resolve: () => resolveFromMusicBrainz(artistName, artistMbid, deps, cfg.tracksPerArtist),
    })
  }

  for (const search of searches) {
    attempted = true
    try {
      const tracks = await search.resolve()
      if (tracks.length > 0) {
        return {
          tracks,
          outcome: {
            artistName,
            artistMbid,
            status: 'resolved',
            resolvedTrackCount: tracks.length,
            includedTrackCount: tracks.length,
          },
        }
      }
    } catch {
      failed = true
      // Upstream errors can include request credentials or signed URLs.
      console.warn(`[track-resolver] ${search.source} lookup failed`)
    }
  }

  return {
    tracks: [],
    outcome: {
      artistName,
      artistMbid,
      status: failed ? 'error' : attempted ? 'unmatched' : 'unavailable',
      resolvedTrackCount: 0,
      includedTrackCount: 0,
    },
  }
}

export async function resolvePlaylistTracksDetailed(
  artists: { name: string; mbid?: string; recording?: SuggestedRecording }[],
  deps: TrackResolverDeps,
  config: TrackResolverConfig,
): Promise<ArtistTrackResolution[]> {
  const queue = new PQueue({ concurrency: 2, interval: 500, intervalCap: 1 })

  return Promise.all(
    artists.map((artist) =>
      queue.add(() =>
        resolveTracksForArtistDetailed(artist.name, artist.mbid, deps, config, artist.recording),
      ),
    ),
  )
}
