import type { DiscoveryModeDefinition } from '../types'

export function createLabelsMode(): DiscoveryModeDefinition {
  return {
    id: 'labels',
    label: 'Labels',
    description: 'Discover artists connected through label catalogs',
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
