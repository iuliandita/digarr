import { createMusicBrainzClient } from '@/core/clients/musicbrainz'
import { createLastFmSource } from '@/core/plugins/lastfm'
import { createListenBrainzSource } from '@/core/plugins/listenbrainz'
import type { DiscoverySource } from '@/core/plugins/types'
import { createSimilarAdapter } from '@/core/subscriptions/adapters/similar'
import type { DiscoveryModeDefinition } from '../types'
import { getDiscoveryModeConnections, getNormalizedLimit, getProviderPath } from './runtime'

function parseProviderFromSource(source: string): string {
  return source.startsWith('similar-subscription:')
    ? source.slice('similar-subscription:'.length)
    : source
}

async function getSupportedSources(userId: number): Promise<DiscoverySource[]> {
  const connections = await getDiscoveryModeConnections(userId)
  const sources: DiscoverySource[] = []

  if (connections?.listenbrainzUsername && connections.listenbrainzToken) {
    sources.push(
      createListenBrainzSource(connections.listenbrainzUsername, connections.listenbrainzToken),
    )
  }
  if (connections?.lastfmUsername && connections.lastfmApiKey) {
    sources.push(createLastFmSource(connections.lastfmUsername, connections.lastfmApiKey))
  }

  return sources
}

export function createSimilarArtistWebMode(): DiscoveryModeDefinition {
  return {
    id: 'similar-artist-web',
    label: 'Similar Artist Web',
    description: 'Discover artists from web-based similar artist graph lookups',
    availability: 'fallback',
    easyFields: [
      { key: 'seedArtists', label: 'Seed artists', type: 'multiselect', required: true },
    ],
    advancedFields: [
      { key: 'seedArtists', label: 'Seed artists', type: 'multiselect', required: true },
      { key: 'limit', label: 'Limit', type: 'number', required: true },
    ],
    executor: async (request) => {
      const sources = await getSupportedSources(request.userId)
      if (sources.length === 0) {
        throw new Error('Connect ListenBrainz or Last.fm to use this mode.')
      }

      const selectedProviders = getProviderPath(request).filter((provider) =>
        sources.some((source) => source.id === provider),
      )
      const limit = getNormalizedLimit(request, 25)
      // The adapter swallows per-call errors; count them to tell "all failed" from "no results".
      let calls = 0
      let failures = 0
      let lastError: unknown
      const trackedSources: DiscoverySource[] = sources.map((source) => ({
        ...source,
        getSimilarArtists: async (...args: Parameters<DiscoverySource['getSimilarArtists']>) => {
          calls += 1
          try {
            return await source.getSimilarArtists(...args)
          } catch (err) {
            failures += 1
            lastError = err
            throw err
          }
        },
      }))
      const adapter = createSimilarAdapter(trackedSources, {
        searchArtist: createMusicBrainzClient().searchArtist,
      })
      const result = await adapter.fetch(
        {
          seedArtists: request.normalizedSettings.seedArtists,
          providers:
            selectedProviders.length > 0 ? selectedProviders : sources.map((source) => source.id),
        },
        { limit },
      )
      if (calls > 0 && failures === calls) {
        const detail = lastError instanceof Error ? lastError.message : String(lastError)
        throw new Error(`All similar-artist lookups failed: ${detail}`)
      }

      return {
        candidates: result.artists.slice(0, limit).map((artist) => ({
          candidateType: 'artist' as const,
          name: artist.name,
          mbid: artist.mbid,
          provenanceProvider: parseProviderFromSource(artist.source),
          confidenceHint: artist.similarityScore,
          fallbackUsed: false,
        })),
      }
    },
  }
}
