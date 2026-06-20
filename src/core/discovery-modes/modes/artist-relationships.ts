import { createMusicBrainzClient } from '@/core/clients/musicbrainz'
import type { DiscoveryModeDefinition, RawDiscoveryCandidate } from '../types'
import { getNormalizedLimit, normalizeDiscoveryName } from './runtime'

type SeedArtist = { name: string; mbid?: string }

// Artist-artist relation types MusicBrainz exposes that are useful for
// discovery. Used to populate the picker and bound which edges we follow.
const SUPPORTED_RELATIONSHIP_TYPES = [
  'member of band',
  'collaboration',
  'supporting musician',
  'is person',
  'sibling',
  'married',
  'involved with',
] as const

function parseSeeds(raw: unknown): SeedArtist[] {
  const items = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(',').map((s) => s.trim())
      : []
  const seeds: SeedArtist[] = []
  for (const item of items) {
    if (typeof item === 'string') {
      if (item.trim()) seeds.push({ name: item.trim() })
    } else if (item && typeof item === 'object' && 'name' in item) {
      const rec = item as Record<string, unknown>
      const name = String(rec.name ?? '').trim()
      if (name) seeds.push({ name, mbid: typeof rec.mbid === 'string' ? rec.mbid : undefined })
    }
  }
  return seeds
}

function parseRelationshipTypes(raw: unknown): Set<string> {
  const items = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(',').map((s) => s.trim())
      : []
  return new Set(items.filter((v): v is string => typeof v === 'string' && v.trim().length > 0))
}

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
        required: false,
        options: SUPPORTED_RELATIONSHIP_TYPES.map((t) => ({ value: t, label: t })),
      },
      { key: 'limit', label: 'Limit', type: 'number', required: true },
    ],
    executor: async (request) => {
      const seeds = parseSeeds(request.normalizedSettings.seedArtists)
      if (seeds.length === 0) {
        throw new Error('Add at least one seed artist to use this mode.')
      }
      const limit = getNormalizedLimit(request, 25)
      const selectedTypes = parseRelationshipTypes(request.normalizedSettings.relationshipTypes)
      const mb = createMusicBrainzClient()

      const seedNames = new Set(seeds.map((s) => normalizeDiscoveryName(s.name)))
      const byMbid = new Map<string, RawDiscoveryCandidate>()

      for (const seed of seeds) {
        // Resolve to an MBID when the seed only carries a name (one extra call).
        let mbid = seed.mbid
        if (!mbid) {
          const search = await mb.searchArtist(seed.name)
          mbid = search.artists[0]?.id
        }
        if (!mbid) continue

        const artist = await mb.lookupArtistRelations(mbid)
        for (const rel of artist.relations ?? []) {
          if (!rel.artist) continue
          if (selectedTypes.size > 0 && !selectedTypes.has(rel.type)) continue
          const related = rel.artist
          if (seedNames.has(normalizeDiscoveryName(related.name))) continue
          if (byMbid.has(related.id)) continue
          byMbid.set(related.id, {
            candidateType: 'artist',
            name: related.name,
            mbid: related.id,
            provenanceProvider: 'musicbrainz',
            explanationHint: rel.type,
            fallbackUsed: false,
          })
        }
        if (byMbid.size >= limit) break
      }

      return { candidates: [...byMbid.values()].slice(0, limit) }
    },
  }
}
