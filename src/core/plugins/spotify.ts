import { createSpotifyClient, type SpotifyTimeRange } from '@/core/clients/spotify'
import type { DiscoverySource } from './types'

export function createSpotifySource(accessToken: string): DiscoverySource {
  const client = createSpotifyClient(accessToken)

  return {
    id: 'spotify',
    name: 'Spotify',
    capabilities: ['topArtists', 'recentListening'],

    async getTopArtists(limit) {
      const windows: SpotifyTimeRange[] = ['short_term', 'medium_term', 'long_term']
      const perWindow = await Promise.all(windows.map((w) => client.getTopArtists(w, limit)))

      const merged = new Map<string, { name: string; playCount: number; genres: Set<string> }>()
      for (const artists of perWindow) {
        for (const a of artists) {
          const key = a.name.toLowerCase()
          const existing = merged.get(key)
          if (existing) {
            existing.playCount = Math.max(existing.playCount, a.popularity)
            for (const g of a.genres ?? []) existing.genres.add(g)
          } else {
            merged.set(key, {
              name: a.name,
              playCount: a.popularity,
              genres: new Set(a.genres ?? []),
            })
          }
        }
      }

      return [...merged.values()].map((m) => ({
        name: m.name,
        playCount: m.playCount,
        source: 'spotify' as const,
        genres: [...m.genres],
      }))
    },

    async getSimilarArtists() {
      // Spotify deprecated the related-artists API for new apps
      return []
    },

    async testConnection() {
      return client.testConnection()
    },

    async getRecentListening(limit) {
      const tracks = await client.getRecentlyPlayed(limit)
      return tracks.map((t) => ({
        name: t.artists[0]?.name ?? 'Unknown',
        track: t.name,
        playedAt: new Date(t.playedAt),
      }))
    },
  }
}
