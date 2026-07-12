import type { ServiceTestResult } from '@/core/types'
import type { DiscoverySource } from './types'

type JellyfinFamilyClient = {
  getTopArtists(limit?: number): Promise<Array<{ name: string; playCount: number }>>
  getFavoriteArtists(limit?: number): Promise<Array<{ name: string; playCount: number }>>
  getRecentlyPlayed(
    limit?: number,
  ): Promise<Array<{ artistName: string; trackName: string; datePlayed: string }>>
  testConnection(): Promise<ServiceTestResult>
}

type JellyfinFamilySourceOptions = {
  id: 'emby' | 'jellyfin'
  name: 'Emby' | 'Jellyfin'
  client: JellyfinFamilyClient
}

export function createJellyfinFamilySource({
  id,
  name,
  client,
}: JellyfinFamilySourceOptions): DiscoverySource {
  return {
    id,
    name,
    capabilities: ['topArtists', 'recentListening'],

    async getTopArtists(limit) {
      const [topByPlays, favorites] = await Promise.all([
        client.getTopArtists(limit),
        client.getFavoriteArtists(limit),
      ])
      const merged = new Map<string, { name: string; playCount: number }>()

      for (const artist of topByPlays) {
        merged.set(artist.name.toLowerCase(), {
          name: artist.name,
          playCount: artist.playCount,
        })
      }

      for (const favorite of favorites) {
        const key = favorite.name.toLowerCase()
        const existing = merged.get(key)
        if (existing) {
          existing.playCount = Math.round(existing.playCount * 1.2)
        } else {
          merged.set(key, {
            name: favorite.name,
            playCount: Math.max(favorite.playCount, 1),
          })
        }
      }

      return Array.from(merged.values())
        .sort((a, b) => b.playCount - a.playCount)
        .slice(0, limit ?? 50)
        .map((artist) => ({ ...artist, source: id }))
    },

    async getSimilarArtists() {
      return []
    },

    testConnection() {
      return client.testConnection()
    },

    async getRecentListening(limit) {
      const tracks = await client.getRecentlyPlayed(limit)
      return tracks.map((track) => ({
        name: track.artistName,
        track: track.trackName,
        playedAt: new Date(track.datePlayed),
      }))
    },
  }
}
