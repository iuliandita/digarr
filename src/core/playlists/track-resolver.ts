import PQueue from 'p-queue'
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

// Returns the first local search dep that's configured.
function getLocalSearchFn(
  deps: TrackResolverDeps,
): ((artist: string) => Promise<LocalTrack[]>) | undefined {
  return deps.jellyfinSearch ?? deps.navidromeSearch ?? deps.plexSearch
}

async function resolveFromLocal(
  artistName: string,
  deps: TrackResolverDeps,
  limit: number,
): Promise<ResolvedTrack[]> {
  const search = getLocalSearchFn(deps)
  if (!search) return []

  const tracks = await search(artistName)
  return tracks
    .filter((t) => normalizeArtist(t.artist) === normalizeArtist(artistName))
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

export type ArtistTrackResolution = {
  tracks: ResolvedTrack[]
  outcome: PlaylistArtistOutcome
}

export async function resolveTracksForArtistDetailed(
  artistName: string,
  artistMbid: string | undefined,
  deps: TrackResolverDeps,
  config: TrackResolverConfig,
): Promise<ArtistTrackResolution> {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  let attempted = false
  let failed = false
  const searches: { source: string; resolve: () => Promise<ResolvedTrack[]> }[] = []

  for (const source of cfg.sourcePriority) {
    if (source === 'local' && getLocalSearchFn(deps)) {
      searches.push({
        source,
        resolve: () => resolveFromLocal(artistName, deps, cfg.tracksPerArtist),
      })
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
  if (artistMbid && deps.musicbrainzRecordings) {
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

export async function resolveTracksForArtist(
  artistName: string,
  artistMbid: string | undefined,
  deps: TrackResolverDeps,
  config: TrackResolverConfig,
): Promise<ResolvedTrack[]> {
  return (await resolveTracksForArtistDetailed(artistName, artistMbid, deps, config)).tracks
}

export async function resolvePlaylistTracksDetailed(
  artists: { name: string; mbid?: string }[],
  deps: TrackResolverDeps,
  config: TrackResolverConfig,
): Promise<ArtistTrackResolution[]> {
  const queue = new PQueue({ concurrency: 2, interval: 500, intervalCap: 1 })

  return Promise.all(
    artists.map((artist) =>
      queue.add(() => resolveTracksForArtistDetailed(artist.name, artist.mbid, deps, config)),
    ),
  )
}

export async function resolvePlaylistTracks(
  artists: { name: string; mbid?: string }[],
  deps: TrackResolverDeps,
  config: TrackResolverConfig,
): Promise<ResolvedTrack[]> {
  return (await resolvePlaylistTracksDetailed(artists, deps, config)).flatMap(
    (result) => result.tracks,
  )
}
