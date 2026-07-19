import { createLastFmClient } from '@/core/clients/lastfm'
import type { DiscoveryConfigField, DiscoveryModeDefinition } from '../types'
import { getDiscoveryModeConnections, getNormalizedLimit } from './runtime'

// Country values for the region select. Last.fm geo.gettopartists uses the
// country name (not an ISO code) as the `country` parameter.
const REGION_OPTIONS = [
  { value: 'global', label: 'discoveryMode.option.global' },
  { value: 'United States', label: 'discoveryMode.option.unitedStates' },
  { value: 'United Kingdom', label: 'discoveryMode.option.unitedKingdom' },
  { value: 'Germany', label: 'discoveryMode.option.germany' },
  { value: 'France', label: 'discoveryMode.option.france' },
  { value: 'Japan', label: 'discoveryMode.option.japan' },
  { value: 'Brazil', label: 'discoveryMode.option.brazil' },
  { value: 'Canada', label: 'discoveryMode.option.canada' },
]

function parseChartLimit(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 50
  return Math.min(Math.max(Math.trunc(n), 1), 100)
}

export function createChartsMode(): DiscoveryModeDefinition {
  const fields: DiscoveryConfigField[] = [
    {
      key: 'region',
      label: 'discoveryMode.field.region',
      type: 'select',
      required: false,
      options: REGION_OPTIONS,
    },
    {
      key: 'limit',
      label: 'discoveryMode.field.limit',
      type: 'number',
      required: false,
    },
  ]
  return {
    id: 'charts',
    label: 'Charts',
    description: 'Discover artists trending on global or regional charts',
    availability: 'fallback',
    easyFields: fields,
    advancedFields: fields,
    executor: async (request) => {
      const connections = await getDiscoveryModeConnections(request.userId)
      if (!connections?.lastfmApiKey) {
        throw new Error('Connect Last.fm to use this mode.')
      }

      const limit = parseChartLimit(
        request.normalizedSettings.limit ?? getNormalizedLimit(request, 50, 100),
      )

      const rawRegion = request.normalizedSettings.region
      const region = typeof rawRegion === 'string' ? rawRegion.trim() : 'global'
      const country = region === 'global' ? undefined : region

      // username is required by createLastFmClient but chart endpoints are
      // API-key only and do not use it. Fall back to empty string when absent.
      const username = connections.lastfmUsername ?? ''
      const client = createLastFmClient(username, connections.lastfmApiKey)

      const chartArtists = await client.getChartTopArtists(limit, country)

      const candidates = chartArtists.map((a) => ({
        candidateType: 'artist' as const,
        name: a.name,
        mbid: a.mbid || undefined,
        provenanceProvider: 'lastfm',
        fallbackUsed: true,
      }))

      return { candidates }
    },
  }
}
