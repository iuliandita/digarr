import type { DiscoveryModeDefinition } from '../types'

export function createSimilarArtistWebMode(): DiscoveryModeDefinition {
  return {
    id: 'similar-artist-web',
    label: 'Similar Artist Web',
    description: 'Discover artists from web-based similar artist graph lookups',
    availability: 'fallback',
    easyFields: [
      { key: 'seedArtists', label: 'Seed artists', type: 'multiselect', required: true },
    ],
    advancedFields: [
      { key: 'seedArtists', label: 'Seed artists', type: 'multiselect', required: true },
      { key: 'limit', label: 'Limit', type: 'number', required: true },
    ],
    executor: async () => ({ candidates: [] }),
  }
}
