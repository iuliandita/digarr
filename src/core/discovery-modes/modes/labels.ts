import { createDiscogsClient } from '@/core/clients/discogs'
import type { DiscoveryModeDefinition, RawDiscoveryCandidate } from '../types'
import {
  getDiscoveryModeConnections,
  getNormalizedLimit,
  normalizeDiscoveryName,
  parseSeeds,
} from './runtime'

// Bounded traversal so a label fan-out stays cheap on the Discogs 60/min limit:
// at most 3 seeds, one label per seed => ~2 search calls per seed (~6 total).
const MAX_SEEDS = 3
const LABELS_PER_SEED = 1

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
    executor: async (request) => {
      const connections = await getDiscoveryModeConnections(request.userId)
      if (!connections?.discogsToken) {
        throw new Error('Connect Discogs to use this mode.')
      }

      const seeds = parseSeeds(request.normalizedSettings.seedArtists).slice(0, MAX_SEEDS)
      if (seeds.length === 0) {
        throw new Error('Add at least one seed artist to use this mode.')
      }
      const limit = getNormalizedLimit(request, 25)
      const discogs = createDiscogsClient(
        connections.discogsToken,
        connections.discogsUsername ?? '',
      )

      const seedNames = new Set(seeds.map((s) => normalizeDiscoveryName(s.name)))
      const byName = new Map<string, RawDiscoveryCandidate>()

      for (const seed of seeds) {
        const labels = await discogs.getLabelsForArtist(seed.name, LABELS_PER_SEED)
        for (const label of labels) {
          const artistNames = await discogs.getArtistsForLabel(label, limit)
          for (const name of artistNames) {
            const key = normalizeDiscoveryName(name)
            if (seedNames.has(key) || byName.has(key)) continue
            byName.set(key, {
              candidateType: 'artist',
              name,
              provenanceProvider: 'discogs',
              explanationHint: label,
              fallbackUsed: true,
            })
          }
        }
        if (byName.size >= limit) break
      }

      return { candidates: [...byName.values()].slice(0, limit) }
    },
  }
}
