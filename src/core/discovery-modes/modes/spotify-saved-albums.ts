import { createSpotifyClient } from '@/core/clients/spotify'
import type { DiscoveryConfigField, DiscoveryModeDefinition } from '../types'
import { getDiscoveryModeSpotifyToken, getNormalizedLimit } from './runtime'

export function createSpotifySavedAlbumsMode(): DiscoveryModeDefinition {
  const fields: DiscoveryConfigField[] = [
    {
      key: 'limit',
      label: 'discoveryMode.field.limit',
      type: 'number',
      required: false,
    },
  ]
  return {
    id: 'spotify-saved-albums',
    label: 'Spotify Saved Albums',
    description: 'Discover artists from the albums you saved on Spotify',
    availability: 'fallback',
    easyFields: fields,
    advancedFields: fields,
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
