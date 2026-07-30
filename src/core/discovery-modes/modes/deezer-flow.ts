import { createDeezerUserClient } from '@/core/clients/deezer-user'
import type { DiscoveryModeDefinition } from '../types'
import { createUserArtistCollectionMode } from './user-artist-collection'

export function createDeezerFlowMode(): DiscoveryModeDefinition {
  return createUserArtistCollectionMode({
    id: 'deezer-flow',
    label: 'Deezer Flow',
    description: 'Discover artists from your personalized Deezer Flow feed',
    provider: 'deezer',
    fetchArtists: (token, limit) => createDeezerUserClient(token).getFlowRecommendations(limit),
  })
}
