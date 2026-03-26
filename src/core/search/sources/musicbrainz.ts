import type { SearchResult, SearchSource } from '@/core/search/multi-source'
import { rankSearchMatches } from '@/core/search/relevance'

type MBSearchResult = {
  artists: Array<{
    id: string
    name: string
    disambiguation?: string
    tags?: Array<{ name: string; count: number }>
    score: number
  }>
}

export function createMusicBrainzSearchSource(mbClient: {
  searchArtist(query: string): Promise<unknown>
}): SearchSource {
  return {
    id: 'musicbrainz',
    name: 'MusicBrainz',
    available: true,

    async search(query: string, limit: number): Promise<SearchResult[]> {
      const raw = await mbClient.searchArtist(query)
      const data = raw as MBSearchResult
      const artists = rankSearchMatches(data.artists ?? [], query, {
        limit,
        maxResults: Math.min(limit, 8),
        minScore: query.trim().length >= 4 ? 0.55 : 0.42,
        fallbackResults: 4,
        getName: (artist) => artist.name,
        getTieBreaker: (artist) => artist.score,
        getBaseScore: (artist) => artist.score / 100,
        baseScoreWeight: 0.2,
      })
      return artists.map((artist) => ({
        name: artist.name,
        mbid: artist.id,
        images: [],
        genres: (artist.tags ?? []).map((t) => t.name),
        sourceId: 'musicbrainz',
        sourceUrl: `https://musicbrainz.org/artist/${artist.id}`,
        externalId: artist.id,
      }))
    },
  }
}
