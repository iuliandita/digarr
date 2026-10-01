import type { PlaylistStrategy } from '@/db/schema'
import { auditionStrategy } from './strategies/audition'
import { genreFocusStrategy } from './strategies/genre-focus'
import { moodMixStrategy } from './strategies/mood-mix'
import { rediscoverStrategy } from './strategies/rediscover'
import type { PlaylistStrategyImpl, StrategyDeps } from './strategies/types'
import { weeklyDigestStrategy } from './strategies/weekly-digest'
import { resolvePlaylistTracksDetailed } from './track-resolver'
import type {
  PlaylistGenerationSummary,
  ResolvedTrack,
  TrackResolverConfig,
  TrackResolverDeps,
} from './types'

export type GenerationResult = {
  tracks: ResolvedTrack[]
  artistCount: number
  strategy: string
  resolution: PlaylistGenerationSummary
}

export function getStrategy(strategy: PlaylistStrategy): PlaylistStrategyImpl {
  switch (strategy) {
    case 'audition':
      return auditionStrategy
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
    tracksPerArtist: strategy === 'audition' ? 1 : 3,
    sourcePriority: config.trackSourcePriority,
  }

  const results = await resolvePlaylistTracksDetailed(artists, resolverDeps, resolverConfig)
  const tracks: ResolvedTrack[] = []
  const outcomes = results.map((result) => {
    const included = result.tracks.slice(0, Math.max(0, config.size - tracks.length))
    tracks.push(...included)
    return {
      ...result.outcome,
      includedTrackCount: included.length,
      status:
        result.outcome.status === 'resolved' && included.length === 0
          ? ('limited' as const)
          : result.outcome.status,
    }
  })
  const resolution: PlaylistGenerationSummary = {
    requestedArtistCount: artists.length,
    resolvedArtistCount: outcomes.filter((outcome) => outcome.resolvedTrackCount > 0).length,
    includedArtistCount: outcomes.filter((outcome) => outcome.includedTrackCount > 0).length,
    trackCount: tracks.length,
    outcomes,
  }

  return {
    tracks,
    artistCount: artists.length,
    strategy,
    resolution,
  }
}
