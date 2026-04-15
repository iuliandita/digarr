import { createJellyfinClient } from '@/core/clients/jellyfin'
import type { DiscoverySource } from './types'

export function createJellyfinSource(
  url: string,
  apiKey: string,
  userId: string,
  skipTlsVerify?: boolean,
): DiscoverySource {
  const client = createJellyfinClient(url, apiKey, userId, { skipTlsVerify })

  return {
    id: 'jellyfin',
    name: 'Jellyfin',
    capabilities: ['topArtists', 'recentListening'],

    async getTopArtists(limit) {
      const [topByPlays, favorites] = await Promise.all([
        client.getTopArtists(limit),
        client.getFavoriteArtists(limit),
      ])

      // Build a map from top artists keyed by name (lowercase for matching)
      const merged = new Map<string, { name: string; playCount: number }>()
      for (const a of topByPlays) {
        merged.set(a.name.toLowerCase(), {
          name: a.name,
          playCount: a.playCount,
        })
      }

      // Merge favorites: boost existing entries, add new ones
      for (const fav of favorites) {
        const key = fav.name.toLowerCase()
        const existing = merged.get(key)
        if (existing) {
          // Favorite already in top list - 1.2x play count boost
          existing.playCount = Math.round(existing.playCount * 1.2)
        } else {
          // New favorite not in top list - add with their play count (min 1)
          merged.set(key, {
            name: fav.name,
            playCount: Math.max(fav.playCount, 1),
          })
        }
      }

      return Array.from(merged.values())
        .sort((a, b) => b.playCount - a.playCount)
        .slice(0, limit ?? 50)
        .map((a) => ({
          name: a.name,
          playCount: a.playCount,
          source: 'jellyfin',
        }))
    },

    async getSimilarArtists() {
      // Jellyfin does not provide similar artist data
      return []
    },

    async testConnection() {
      return client.testConnection()
    },

    async getRecentListening(limit) {
      const tracks = await client.getRecentlyPlayed(limit)
      return tracks.map((t) => ({
        name: t.artistName,
        track: t.trackName,
        playedAt: new Date(t.datePlayed),
      }))
    },
  }
}
