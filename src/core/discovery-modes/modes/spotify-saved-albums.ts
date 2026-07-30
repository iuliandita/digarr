import { createSpotifyClient } from '@/core/clients/spotify'
import type { DiscoveryModeDefinition } from '../types'
import { createUserArtistCollectionMode } from './user-artist-collection'

export function createSpotifySavedAlbumsMode(): DiscoveryModeDefinition {
  return createUserArtistCollectionMode({
    id: 'spotify-saved-albums',
    label: 'Spotify Saved Albums',
    description: 'Discover artists from the albums you saved on Spotify',
    provider: 'spotify',
    fetchArtists: (token, limit) => createSpotifyClient(token).getSavedAlbums(limit),
  })
}
