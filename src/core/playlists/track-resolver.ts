import PQueue from 'p-queue'
import type {
  LocalTrack,
  MBRecording,
  ResolvedTrack,
  TrackResolverConfig,
  TrackResolverDeps,
} from './types'

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

  try {
    const tracks = await search(artistName)
    return tracks.slice(0, limit).map((t) => ({
      artistName,
      trackName: t.name,
      localPath: t.path,
      source: 'local' as const,
    }))
  } catch (error: unknown) {
    console.warn('[track-resolver]', error)
    return []
  }
}

async function resolveFromSpotify(
  artistName: string,
  deps: TrackResolverDeps,
  limit: number,
): Promise<ResolvedTrack[]> {
  if (!deps.spotifySearch) return []

  try {
    const results = await deps.spotifySearch(`artist:${artistName}`, limit)
    return results
      .sort((a, b) => b.popularity - a.popularity)
      .slice(0, limit)
      .map((t) => ({
        artistName,
        trackName: t.name,
        spotifyUri: t.uri,
        source: 'spotify' as const,
      }))
  } catch (error: unknown) {
    console.warn('[track-resolver]', error)
    return []
  }
}

async function resolveFromDeezer(
  artistName: string,
  deps: TrackResolverDeps,
  limit: number,
): Promise<ResolvedTrack[]> {
  if (!deps.deezerSearch) return []

  try {
    const results = await deps.deezerSearch(`artist:"${artistName}"`, limit)
    return results
      .sort((a, b) => b.rank - a.rank)
      .slice(0, limit)
      .map((t) => ({
        artistName,
        trackName: t.name,
        deezerId: t.id,
        source: 'deezer' as const,
      }))
  } catch (error: unknown) {
    console.warn('[track-resolver]', error)
    return []
  }
}

async function resolveFromMusicBrainz(
  artistName: string,
  artistMbid: string,
  deps: TrackResolverDeps,
  limit: number,
): Promise<ResolvedTrack[]> {
  if (!deps.musicbrainzRecordings) return []

  try {
    const recordings = await deps.musicbrainzRecordings(artistMbid)
    return recordings.slice(0, limit).map((r: MBRecording) => ({
      artistName,
      trackName: r.title,
      mbid: r.id,
      source: 'musicbrainz' as const,
    }))
  } catch (error: unknown) {
    console.warn('[track-resolver]', error)
    return []
  }
}

export async function resolveTracksForArtist(
  artistName: string,
  artistMbid: string | undefined,
  deps: TrackResolverDeps,
  config: TrackResolverConfig,
): Promise<ResolvedTrack[]> {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const limit = cfg.tracksPerArtist

  for (const source of cfg.sourcePriority) {
    let tracks: ResolvedTrack[] = []

    if (source === 'local') {
      tracks = await resolveFromLocal(artistName, deps, limit)
    } else if (source === 'spotify') {
      tracks = await resolveFromSpotify(artistName, deps, limit)
    } else if (source === 'deezer') {
      tracks = await resolveFromDeezer(artistName, deps, limit)
    }

    if (tracks.length > 0) return tracks
  }

  // MusicBrainz fallback - only if we have an MBID
  if (artistMbid) {
    const mbTracks = await resolveFromMusicBrainz(artistName, artistMbid, deps, limit)
    if (mbTracks.length > 0) return mbTracks
  }

  // Nothing resolved - let the caller handle the empty case
  return []
}

export async function resolvePlaylistTracks(
  artists: { name: string; mbid?: string }[],
  deps: TrackResolverDeps,
  config: TrackResolverConfig,
): Promise<ResolvedTrack[]> {
  const queue = new PQueue({ concurrency: 2, interval: 500, intervalCap: 1 })

  const results = await Promise.all(
    artists.map((artist) =>
      queue.add(() => resolveTracksForArtist(artist.name, artist.mbid, deps, config)),
    ),
  )

  return (results as ResolvedTrack[][]).flat()
}
