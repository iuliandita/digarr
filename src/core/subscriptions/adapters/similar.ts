import type { DiscoverySource } from '@/core/plugins/types'
import { deduplicateByName } from '@/core/subscriptions/dedup'
import type {
  AdapterConfigField,
  AdapterResult,
  SubscriptionAdapter,
} from '@/core/subscriptions/types'

type SeedArtist = { name: string; mbid?: string }
type SimilarAdapterDeps = {
  searchArtist?: (
    query: string,
  ) => Promise<{ artists: Array<{ id: string; name: string; score: number }> }>
}

const CONFIG_FIELDS: AdapterConfigField[] = [
  {
    key: 'seedArtists',
    label: 'Seed Artists',
    type: 'text',
    required: true,
    placeholder: 'e.g. Radiohead, Portishead',
    helpText: 'Artists to find similar artists for.',
  },
  {
    key: 'providers',
    label: 'Providers',
    type: 'text',
    required: false,
    placeholder: 'e.g. lastfm,listenbrainz (leave blank for all)',
    helpText: 'Comma-separated source IDs to use. Leave blank to use all capable sources.',
  },
]

function parseSeeds(raw: unknown): SeedArtist[] {
  if (!raw) return []
  if (Array.isArray(raw)) {
    return (raw as unknown[]).flatMap((item) => {
      if (typeof item === 'string') return [{ name: item }]
      if (typeof item === 'object' && item !== null && 'name' in item) {
        return [
          {
            name: String((item as Record<string, unknown>).name),
            mbid: (item as Record<string, unknown>).mbid as string | undefined,
          },
        ]
      }
      return []
    })
  }
  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((name) => ({ name }))
  }
  return []
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase()
}

async function resolveSeedMbids(
  seeds: SeedArtist[],
  searchArtist: NonNullable<SimilarAdapterDeps['searchArtist']>,
): Promise<SeedArtist[]> {
  return Promise.all(
    seeds.map(async (seed) => {
      if (seed.mbid) return seed

      try {
        const searchResult = await searchArtist(seed.name)
        const match =
          searchResult.artists.find(
            (artist) => normalizeName(artist.name) === normalizeName(seed.name),
          ) ?? searchResult.artists[0]

        return match ? { ...seed, mbid: match.id } : seed
      } catch {
        return seed
      }
    }),
  )
}

export function createSimilarAdapter(
  sources: DiscoverySource[],
  deps: SimilarAdapterDeps = {},
): SubscriptionAdapter {
  return {
    type: 'similar',
    label: 'Similar Artists',
    configFields: CONFIG_FIELDS,

    async fetch(
      config: Record<string, unknown>,
      _options?: { limit?: number },
    ): Promise<AdapterResult> {
      const seeds = parseSeeds(config.seedArtists)
      if (seeds.length === 0) return { artists: [] }

      // Filter to capable sources, then optionally narrow by providers list
      let capable = sources.filter((s) => s.capabilities.includes('similarArtists'))

      const providersRaw = config.providers
      if (providersRaw) {
        const allowed = Array.isArray(providersRaw)
          ? (providersRaw as string[])
          : String(providersRaw)
              .split(',')
              .map((p) => p.trim())
              .filter(Boolean)
        capable = capable.filter((s) => allowed.includes(s.id))
      }

      if (capable.length === 0) return { artists: [] }

      const resolvedSeeds =
        deps.searchArtist && capable.some((source) => source.id === 'listenbrainz')
          ? await resolveSeedMbids(seeds, deps.searchArtist)
          : seeds

      // Fan out: all seeds x all sources
      const calls = resolvedSeeds.flatMap((seed) =>
        capable.map((source) =>
          source.getSimilarArtists(seed.name, seed.mbid).then((entries) =>
            entries.map((entry) => ({
              name: entry.name,
              mbid: entry.mbid,
              similarityScore: entry.similarityScore,
              source: `similar-subscription:${source.id}`,
            })),
          ),
        ),
      )

      const allResults = await Promise.all(calls)
      const artists = deduplicateByName(allResults.flat(), (a) => a)

      return { artists }
    },
  }
}
