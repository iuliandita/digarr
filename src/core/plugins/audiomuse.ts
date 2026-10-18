import PQueue from 'p-queue'
import {
  type AudioMuseConfig,
  AudioMuseError,
  createAudioMuseClient,
} from '@/core/clients/audiomuse'
import { decryptField } from '@/core/crypto'
import type { Preferences } from '@/db/schema'
import type { DiscoverySource } from './types'

/** Bound name-only MusicBrainz resolution work contributed by AudioMuse per scan. */
export const AUDIOMUSE_MAX_CANDIDATES = 50

export function getAudioMuseConfig(
  prefs: Partial<Preferences> | null | undefined,
): AudioMuseConfig | null {
  if (!prefs?.audiomuseUrl) return null
  const config: AudioMuseConfig = {
    url: prefs.audiomuseUrl,
    skipTlsVerify: prefs.audiomuseSkipTlsVerify ?? false,
  }
  try {
    config.token = decryptField(prefs.audiomuseToken) ?? undefined
  } catch {
    config.skipReason = 'token_unreadable'
  }
  return config
}

export function createAudioMuseSource(
  config: AudioMuseConfig,
  options: { excludedArtistNames?: Iterable<string> } = {},
): DiscoverySource {
  const client = createAudioMuseClient(config)
  const queue = new PQueue({ concurrency: 2 })
  const normalizeName = (name: string) => name.toLowerCase()
  const excluded = new Set([...(options.excludedArtistNames ?? [])].map(normalizeName))
  const emitted = new Set<string>()
  const summary = {
    seedsQueried: 0,
    seedsWithResults: 0,
    skipReasons: {} as Record<string, number>,
  }
  let unavailable: AudioMuseError | undefined
  let consecutiveUnreachable = 0
  return {
    id: 'audiomuse',
    name: 'AudioMuse-AI',
    capabilities: ['similarArtists'],
    async getTopArtists() {
      return []
    },
    getDiscoverySummary: () => ({ ...summary, skipReasons: { ...summary.skipReasons } }),
    async getSimilarArtists(name) {
      return queue.add(async () => {
        if (unavailable) throw unavailable
        if (emitted.size >= AUDIOMUSE_MAX_CANDIDATES) return []
        summary.seedsQueried++
        try {
          const artists = await client.getSimilarArtists(name)
          consecutiveUnreachable = 0
          summary.seedsWithResults++
          // Rank eligible matches within each seed, preserving the strongest matches first.
          const eligible = artists
            .filter((artist) => !excluded.has(normalizeName(artist.name)))
            .sort((a, b) => b.similarityScore - a.similarityScore)
          const result = []
          const seedNames = new Set<string>()
          const unique = eligible.filter((artist) => {
            const key = normalizeName(artist.name)
            if (seedNames.has(key)) return false
            seedNames.add(key)
            return true
          })
          for (const [rank, artist] of unique.entries()) {
            const key = normalizeName(artist.name)
            if (emitted.has(key) || emitted.size >= AUDIOMUSE_MAX_CANDIDATES) continue
            emitted.add(key)
            result.push({
              ...artist,
              similarityScore: unique.length === 1 ? 1 : 1 - (0.5 * rank) / (unique.length - 1),
            })
          }
          return result
        } catch (error) {
          if (error instanceof AudioMuseError) {
            summary.skipReasons[error.reason] = (summary.skipReasons[error.reason] ?? 0) + 1
            consecutiveUnreachable = error.reason === 'unreachable' ? consecutiveUnreachable + 1 : 0
            if (
              error.reason === 'authentication_required' ||
              error.reason === 'not_indexed' ||
              consecutiveUnreachable >= 2
            )
              unavailable = error
          }
          throw error
        }
      })
    },
    testConnection: () => client.testConnection(),
  }
}
