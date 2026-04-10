import type { DiscoveryModeDefinition } from '../types'

export function createListenBrainzMode(): DiscoveryModeDefinition {
  return {
    id: 'listenbrainz',
    label: 'ListenBrainz',
    description: 'Discover from ListenBrainz graph data and feeds',
    availability: 'strict',
    easyFields: [
      {
        key: 'feedType',
        label: 'Feed',
        type: 'select',
        required: true,
        options: [{ value: 'weekly-jams', label: 'Weekly Jams' }],
      },
    ],
    advancedFields: [
      {
        key: 'feedType',
        label: 'Feed',
        type: 'select',
        required: true,
        options: [
          { value: 'weekly-jams', label: 'Weekly Jams' },
          { value: 'similar-users', label: 'Similar Users' },
        ],
      },
      { key: 'limit', label: 'Limit', type: 'number', required: true },
    ],
    executor: async () => ({ candidates: [] }),
  }
}
