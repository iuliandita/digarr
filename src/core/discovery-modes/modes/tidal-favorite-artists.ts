import { createTidalUserClient } from '@/core/clients/tidal-user'
import type { DiscoveryConfigField, DiscoveryModeDefinition } from '../types'
import { getDiscoveryModeTidalToken, getNormalizedLimit } from './runtime'

export function createTidalFavoriteArtistsMode(): DiscoveryModeDefinition {
  const fields: DiscoveryConfigField[] = [
    {
      key: 'limit',
      label: 'discoveryMode.field.limit',
      type: 'number',
      required: false,
    },
  ]
  return {
    id: 'tidal-favorite-artists',
    label: 'TIDAL Favorite Artists',
    description: 'Discover from the artists in your TIDAL collection',
    availability: 'fallback',
    easyFields: fields,
    advancedFields: fields,
    executor: async (request) => {
      const token = await getDiscoveryModeTidalToken(request.userId)
      if (!token) {
        throw new Error('Connect TIDAL to use this mode.')
      }

      const limit = getNormalizedLimit(request, 50, 100)
      const client = createTidalUserClient(token)
      const favorites = await client.getFavoriteArtists(limit)

      const candidates = favorites.map((a) => ({
        candidateType: 'artist' as const,
        name: a.name,
        mbid: undefined,
        provenanceProvider: 'tidal',
        fallbackUsed: true,
      }))

      return { candidates }
    },
  }
}
