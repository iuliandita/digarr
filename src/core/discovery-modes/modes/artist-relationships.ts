import type { DiscoveryModeDefinition } from '../types'

export function createArtistRelationshipsMode(): DiscoveryModeDefinition {
  return {
    id: 'artist-relationships',
    label: 'Artist Relationships',
    description: 'Discover collaborators, aliases, and adjacent artist graph edges',
    availability: 'strict',
    easyFields: [
      { key: 'seedArtists', label: 'Seed artists', type: 'multiselect', required: true },
    ],
    advancedFields: [
      { key: 'seedArtists', label: 'Seed artists', type: 'multiselect', required: true },
      {
        key: 'relationshipTypes',
        label: 'Relationships',
        type: 'multiselect',
        required: true,
      },
    ],
    executor: async () => ({ candidates: [] }),
  }
}
