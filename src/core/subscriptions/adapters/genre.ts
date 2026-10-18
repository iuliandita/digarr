import type { DiscoverySource } from '@/core/plugins/types'
import { normalizeListenerScore } from '@/core/subscriptions/dedup'
import type { AdapterResult, SubscriptionAdapter } from '@/core/subscriptions/types'

export function createGenreAdapter(sources: DiscoverySource[]): SubscriptionAdapter {
  return {
    type: 'genre',
    async fetch(
      config: Record<string, unknown>,
      options?: { limit?: number },
    ): Promise<AdapterResult> {
      const genre = String(config.genre ?? '')
      if (!genre) return { artists: [] }

      // Filter to capable sources, then optionally narrow by providers list
      let capable = sources.filter(
        (s) => s.capabilities.includes('genreArtists') && typeof s.getGenreArtists === 'function',
      )

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

      const all = await Promise.all(
        capable.map((s) =>
          s.getGenreArtists
            ? s.getGenreArtists(
                genre,
                options?.limit !== undefined ? { limit: options.limit } : undefined,
              )
            : Promise.resolve([]),
        ),
      )

      const artists = all.flat().map((entry) => ({
        name: entry.name,
        mbid: entry.mbid,
        similarityScore: normalizeListenerScore(entry.listeners),
        source: `genre-subscription:${entry.source}`,
      }))

      return { artists }
    },
  }
}
