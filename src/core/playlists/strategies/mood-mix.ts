import type { PlaylistStrategyImpl, StrategyArtist, StrategyDeps } from './types'
import { TRACKS_PER_ARTIST } from './types'

const MOOD_ALIASES: Record<string, string[]> = {
  'd and d': [
    'fantasy',
    'dungeon synth',
    'dungeon',
    'medieval',
    'dark ambient',
    'ambient',
    'folk',
    'soundtrack',
    'epic',
  ],
  dnd: [
    'fantasy',
    'dungeon synth',
    'dungeon',
    'medieval',
    'dark ambient',
    'ambient',
    'folk',
    'soundtrack',
    'epic',
  ],
  'dungeons and dragons': [
    'fantasy',
    'dungeon synth',
    'dungeon',
    'medieval',
    'dark ambient',
    'ambient',
    'folk',
    'soundtrack',
    'epic',
  ],
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replaceAll('&', ' and ')
    .replaceAll(/[^a-z0-9]+/g, ' ')
    .trim()
}

function getMoodKeywords(mood: string): string[] {
  const normalizedMood = normalize(mood)
  const aliases = MOOD_ALIASES[normalizedMood] ?? []
  return [normalizedMood, ...aliases].filter(Boolean)
}

function artistMatchesMood(artist: StrategyArtist, mood: string): boolean {
  if (!artist.genres || artist.genres.length === 0) return false
  const keywords = getMoodKeywords(mood)
  return artist.genres.some((genre) => {
    const normalizedGenre = normalize(genre)
    return keywords.some((keyword) => normalizedGenre.includes(keyword))
  })
}

export const moodMixStrategy: PlaylistStrategyImpl = {
  async selectArtists(
    deps: StrategyDeps,
    config: { size: number; genre?: string; mood?: string },
  ): Promise<StrategyArtist[]> {
    // Fetch a generous pool so we have enough to filter down from.
    const poolLimit = Math.ceil(config.size / TRACKS_PER_ARTIST) * 5

    const artists = await deps.getApprovedArtists({ limit: poolLimit })

    const artistLimit = Math.ceil(config.size / TRACKS_PER_ARTIST)

    const mood = config.mood
    if (!mood) {
      return artists.sort((a, b) => b.score - a.score).slice(0, artistLimit)
    }

    return artists
      .filter((a) => artistMatchesMood(a, mood))
      .sort((a, b) => b.score - a.score)
      .slice(0, artistLimit)
  },
}
