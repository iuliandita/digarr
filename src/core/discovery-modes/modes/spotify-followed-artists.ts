import { createSpotifyClient } from '@/core/clients/spotify'
import type { DiscoveryModeDefinition } from '../types'
import { createUserArtistCollectionMode } from './user-artist-collection'

export function createSpotifyFollowedArtistsMode(): DiscoveryModeDefinition {
  return createUserArtistCollectionMode({
    id: 'spotify-followed-artists',
    label: 'Spotify Followed Artists',
    description: 'Discover from the artists you follow on Spotify',
    provider: 'spotify',
    fetchArtists: (token, limit) => createSpotifyClient(token).getFollowedArtists(limit),
  })
}
