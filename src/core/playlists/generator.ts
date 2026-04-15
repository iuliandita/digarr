import type { PlaylistStrategy } from '@/db/schema'
import { genreFocusStrategy } from './strategies/genre-focus'
import { moodMixStrategy } from './strategies/mood-mix'
import { rediscoverStrategy } from './strategies/rediscover'
import type { PlaylistStrategyImpl, StrategyDeps } from './strategies/types'
import { weeklyDigestStrategy } from './strategies/weekly-digest'
import { resolvePlaylistTracks } from './track-resolver'
import type { ResolvedTrack, TrackResolverConfig, TrackResolverDeps } from './types'

export type GenerationResult = {
  tracks: ResolvedTrack[]
  artistCount: number
  strategy: string
}

export function getStrategy(strategy: PlaylistStrategy): PlaylistStrategyImpl {
  switch (strategy) {
    case 'weekly_digest':
      return weeklyDigestStrategy
    case 'genre_focus':
      return genreFocusStrategy
    case 'mood_mix':
      return moodMixStrategy
    case 'rediscover':
      return rediscoverStrategy
    default: {
      // TypeScript exhaustiveness check - if PlaylistStrategy ever gains a new
      // variant and getStrategy isn't updated, this throws at runtime.
      const _exhaustive: never = strategy
      throw new Error(`Unknown playlist strategy: ${_exhaustive}`)
    }
  }
}

export async function generatePlaylist(
  strategy: PlaylistStrategy,
  config: {
    size: number
    genre?: string
    mood?: string
    trackSourcePriority: ('local' | 'spotify' | 'deezer')[]
  },
  strategyDeps: StrategyDeps,
  resolverDeps: TrackResolverDeps,
): Promise<GenerationResult> {
  const impl = getStrategy(strategy)

  const artists = await impl.selectArtists(strategyDeps, {
    size: config.size,
    genre: config.genre,
    mood: config.mood,
  })

  const resolverConfig: TrackResolverConfig = {
    tracksPerArtist: 3,
    sourcePriority: config.trackSourcePriority,
  }

  const hasResolverDeps = Object.keys(resolverDeps).length > 0

  let tracks: ResolvedTrack[]

  if (hasResolverDeps) {
    const allTracks = await resolvePlaylistTracks(artists, resolverDeps, resolverConfig)
    tracks = allTracks.slice(0, config.size)
  } else {
    // No track resolver deps configured - create artist-level entries
    // so playlists still show the selected artists
    tracks = artists.slice(0, config.size).map((a) => ({
      artistName: a.name,
      trackName: `Top tracks by ${a.name}`,
      mbid: a.mbid,
      source: 'musicbrainz' as const,
    }))
  }

  return {
    tracks,
    artistCount: artists.length,
    strategy,
  }
}
