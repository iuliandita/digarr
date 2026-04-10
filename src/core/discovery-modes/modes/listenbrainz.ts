import { createListenBrainzClient } from '@/core/clients/listenbrainz'
import { createListenBrainzAdapter } from '@/core/subscriptions/adapters/listenbrainz'
import type { DiscoveryModeDefinition } from '../types'
import { getDiscoveryModeConnections, getNormalizedLimit, normalizeDiscoveryName } from './runtime'

function mapFeedArtists(
  artists: Array<{ name: string; similarityScore?: number; source: string }>,
  limit: number,
) {
  return artists.slice(0, limit).map((artist) => ({
    candidateType: 'artist' as const,
    name: artist.name,
    provenanceProvider: artist.source,
    confidenceHint: artist.similarityScore,
    fallbackUsed: false,
  }))
}

async function executeSimilarUsers(userId: number, limit: number) {
  const connections = await getDiscoveryModeConnections(userId)
  const username = connections?.listenbrainzUsername?.trim()
  const token = connections?.listenbrainzToken?.trim()
  if (!username || !token) {
    throw new Error('Connect ListenBrainz to use this mode.')
  }

  const client = createListenBrainzClient(username, token)
  const topArtists = (await client.getTopArtists('month'))
    .filter((artist) => artist.mbid)
    .slice(0, 5)

  const seedNames = new Set(topArtists.map((artist) => normalizeDiscoveryName(artist.name)))
  const seen = new Set<string>()
  const candidates: Array<{
    candidateType: 'artist'
    name: string
    provenanceProvider: string
    confidenceHint: number
    fallbackUsed: false
  }> = []

  for (const seed of topArtists) {
    if (!seed.mbid) continue

    const similarArtists = await client.getSimilarArtists(seed.mbid)
    for (const artist of similarArtists) {
      const normalized = normalizeDiscoveryName(artist.name)
      if (!normalized || seedNames.has(normalized) || seen.has(normalized)) continue

      seen.add(normalized)
      candidates.push({
        candidateType: 'artist',
        name: artist.name,
        provenanceProvider: 'listenbrainz:similar-users',
        confidenceHint: artist.score,
        fallbackUsed: false,
      })

      if (candidates.length >= limit) {
        return { candidates }
      }
    }
  }

  return { candidates }
}

export function createListenBrainzMode(): DiscoveryModeDefinition {
  return {
    id: 'listenbrainz',
    label: 'ListenBrainz',
    description: 'Discover from ListenBrainz graph data and feeds',
    availability: 'strict',
    easyFields: [
      {
        key: 'feedType',
        label: 'Feed',
        type: 'select',
        required: true,
        options: [{ value: 'weekly-jams', label: 'Weekly Jams' }],
      },
    ],
    advancedFields: [
      {
        key: 'feedType',
        label: 'Feed',
        type: 'select',
        required: true,
        options: [
          { value: 'weekly-jams', label: 'Weekly Jams' },
          { value: 'similar-users', label: 'Similar Users' },
        ],
      },
      { key: 'limit', label: 'Limit', type: 'number', required: true },
    ],
    executor: async (request) => {
      const connections = await getDiscoveryModeConnections(request.userId)
      const username = connections?.listenbrainzUsername?.trim()
      const token = connections?.listenbrainzToken?.trim()
      if (!username || !token) {
        throw new Error('Connect ListenBrainz to use this mode.')
      }

      const feedType =
        request.normalizedSettings.feedType === 'similar-users' ? 'similar-users' : 'weekly-jams'
      const limit = getNormalizedLimit(request, 25)

      if (feedType === 'similar-users') {
        return executeSimilarUsers(request.userId, limit)
      }

      const adapter = createListenBrainzAdapter({ username, token })
      const result = await adapter.fetch(
        { feedType },
        { limit: request.normalizedSettings.limit as number | undefined },
      )

      return {
        candidates: mapFeedArtists(result.artists, limit),
      }
    },
  }
}
