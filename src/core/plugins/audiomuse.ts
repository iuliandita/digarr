import PQueue from 'p-queue'
import {
  type AudioMuseConfig,
  AudioMuseError,
  createAudioMuseClient,
} from '@/core/clients/audiomuse'
import { decryptField } from '@/core/crypto'
import type { Preferences } from '@/db/schema'
import type { DiscoverySource } from './types'

export function getAudioMuseConfig(
  prefs: Partial<Preferences> | null | undefined,
): AudioMuseConfig | null {
  if (!prefs?.audiomuseUrl) return null
  return {
    url: prefs.audiomuseUrl,
    token: decryptField(prefs.audiomuseToken) ?? undefined,
    skipTlsVerify: prefs.audiomuseSkipTlsVerify ?? false,
  }
}

export function createAudioMuseSource(config: AudioMuseConfig): DiscoverySource {
  const client = createAudioMuseClient(config)
  const queue = new PQueue({ concurrency: 2 })
  let unavailable: AudioMuseError | undefined
  return {
    id: 'audiomuse',
    name: 'AudioMuse-AI',
    capabilities: ['similarArtists'],
    async getTopArtists() {
      return []
    },
    async getSimilarArtists(name) {
      return queue.add(async () => {
        if (unavailable) throw unavailable
        try {
          return await client.getSimilarArtists(name)
        } catch (error) {
          if (error instanceof AudioMuseError && error.reason !== 'artist_unknown')
            unavailable = error
          throw error
        }
      })
    },
    testConnection: () => client.testConnection(),
  }
}
