import { createTidalUserClient } from '@/core/clients/tidal-user'
import type { DiscoveryModeDefinition } from '../types'
import { createUserArtistCollectionMode } from './user-artist-collection'

export function createTidalFavoriteArtistsMode(): DiscoveryModeDefinition {
  return createUserArtistCollectionMode({
    id: 'tidal-favorite-artists',
    label: 'TIDAL Favorite Artists',
    description: 'Discover from the artists in your TIDAL collection',
    provider: 'tidal',
    stability: 'experimental',
    fetchArtists: (token, limit) => createTidalUserClient(token).getFavoriteArtists(limit),
  })
}
