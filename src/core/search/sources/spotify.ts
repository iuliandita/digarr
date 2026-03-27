import type { SearchResult, SearchSource } from '@/core/search/multi-source'

type SpotifyArtistItem = {
  id: string
  name: string
  genres: string[]
  popularity: number
  images: Array<{ url: string; width: number; height: number }>
}

type SpotifySearchResponse = {
  artists: {
    items: SpotifyArtistItem[]
  }
}

export function createSpotifySearchSource(deps: {
  getToken: () => Promise<string>
  baseUrl?: string
}): SearchSource {
  const baseUrl = deps.baseUrl ?? 'https://api.spotify.com/v1'

  return {
    id: 'spotify',
    name: 'Spotify',
    available: true,

    async search(query: string, limit: number): Promise<SearchResult[]> {
      const token = await deps.getToken()
      const params = new URLSearchParams({
        type: 'artist',
        q: query,
        limit: String(Math.min(limit, 50)),
      })
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 10_000)
      let res: Response
      try {
        res = await fetch(`${baseUrl}/search?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timer)
      }
      if (!res.ok) {
        throw new Error(`Spotify search HTTP ${res.status}`)
      }
      const data = (await res.json()) as SpotifySearchResponse
      return (data.artists?.items ?? []).map((item) => ({
        name: item.name,
        images: item.images.map((img) => ({ url: img.url, source: 'spotify' })),
        genres: item.genres ?? [],
        popularity: item.popularity,
        sourceId: 'spotify',
        sourceUrl: `https://open.spotify.com/artist/${item.id}`,
        externalId: item.id,
      }))
    },
  }
}
