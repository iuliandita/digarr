import { createSpotifyClient } from '@/core/clients/spotify'
import type { DiscoveryConfigField, DiscoveryModeDefinition } from '../types'
import { getDiscoveryModeSpotifyToken, getNormalizedLimit } from './runtime'

export function createSpotifyFollowedArtistsMode(): DiscoveryModeDefinition {
  const fields: DiscoveryConfigField[] = [
    {
      key: 'limit',
      label: 'discoveryMode.field.limit',
      type: 'number',
      required: false,
    },
  ]
  return {
    id: 'spotify-followed-artists',
    label: 'Spotify Followed Artists',
    description: 'Discover from the artists you follow on Spotify',
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
      const followed = await client.getFollowedArtists(limit)

      const candidates = followed.map((a) => ({
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
