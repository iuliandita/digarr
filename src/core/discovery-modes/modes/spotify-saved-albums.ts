import { createSpotifyClient } from '@/core/clients/spotify'
import type { DiscoveryModeDefinition } from '../types'
import { getDiscoveryModeSpotifyToken, getNormalizedLimit } from './runtime'

export function createSpotifySavedAlbumsMode(): DiscoveryModeDefinition {
  return {
    id: 'spotify-saved-albums',
    label: 'Spotify Saved Albums',
    description: 'Discover artists from the albums you saved on Spotify',
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
      const token = await getDiscoveryModeSpotifyToken(request.userId)
      if (!token) {
        throw new Error('Connect Spotify to use this mode.')
      }

      const limit = getNormalizedLimit(request, 50, 100)
      const client = createSpotifyClient(token)
      const savedArtists = await client.getSavedAlbums(limit)

      const candidates = savedArtists.map((a) => ({
        candidateType: 'artist' as const,
        name: a.name,
        mbid: undefined,
        provenanceProvider: 'spotify',
        fallbackUsed: true,
      }))

      return { candidates }
    },
  }
}
