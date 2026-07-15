import type { createTidalClient } from '@/core/clients/tidal'
import type { SearchResult, SearchSource } from '@/core/search/multi-source'
import { rankSearchMatches } from '@/core/search/relevance'

export function createTidalSearchSource(
  client: ReturnType<typeof createTidalClient>,
): SearchSource {
  return {
    id: 'tidal',
    name: 'TIDAL',
    available: true,

    async search(query: string, limit: number): Promise<SearchResult[]> {
      const results = await client.searchArtists(query, Math.min(limit, 25))
      const ranked = rankSearchMatches(results, query, {
        limit,
        maxResults: Math.min(limit, 8),
        minScore: query.trim().length >= 4 ? 0.58 : 0.46,
        fallbackResults: 4,
        getName: (item) => item.name,
        getTieBreaker: (item) => item.popularity,
      })
      return ranked.map((item) => ({
        name: item.name,
        images: item.imageUrl ? [{ url: item.imageUrl, source: 'tidal' }] : [],
        genres: [],
        popularity: item.popularity,
        sourceId: 'tidal',
        sourceUrl: item.url,
        externalId: String(item.id),
      }))
    },
  }
}
