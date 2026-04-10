import type { DiscoveryModeDefinition } from '../types'

export function createReleaseRadarMode(): DiscoveryModeDefinition {
  return {
    id: 'release-radar',
    label: 'Release Radar',
    description: 'Discover from new releases connected to your tracked artists',
    availability: 'strict',
    easyFields: [
      { key: 'windowDays', label: 'Release window', type: 'number', required: true },
    ],
    advancedFields: [
      { key: 'windowDays', label: 'Release window', type: 'number', required: true },
      { key: 'includeReissues', label: 'Include reissues', type: 'toggle' },
    ],
    executor: async () => ({ candidates: [] }),
  }
}
