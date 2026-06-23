import { createDeezerUserClient } from '@/core/clients/deezer-user'
import type { DiscoveryModeDefinition } from '../types'
import { getDiscoveryModeDeezerToken, getNormalizedLimit } from './runtime'

export function createDeezerFlowMode(): DiscoveryModeDefinition {
  return {
    id: 'deezer-flow',
    label: 'Deezer Flow',
    description: 'Discover artists from your personalized Deezer Flow feed',
    availability: 'fallback',
    easyFields: [
      {
        key: 'limit',
        label: 'discoveryMode.field.limit',
        type: 'number',
        required: false,
      },
    ],
    advancedFields: [
      {
        key: 'limit',
        label: 'discoveryMode.field.limit',
        type: 'number',
        required: false,
      },
    ],
    executor: async (request) => {
      const token = await getDiscoveryModeDeezerToken(request.userId)
      if (!token) {
        throw new Error('Connect Deezer to use this mode.')
      }

      const limit = getNormalizedLimit(request, 50, 100)
      const client = createDeezerUserClient(token)
      const flowArtists = await client.getFlowRecommendations(limit)

      const candidates = flowArtists.map((a) => ({
        candidateType: 'artist' as const,
        name: a.name,
        mbid: undefined,
        provenanceProvider: 'deezer',
        fallbackUsed: true,
      }))

      return { candidates }
    },
  }
}
