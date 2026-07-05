import { createPlexClient } from '@/core/clients/plex'
import type { DiscoverySource } from './types'

export function createPlexSource(
  url: string,
  token: string,
  sectionId?: string | null,
): DiscoverySource {
  const client = createPlexClient(url, token, { sectionId })

  return {
    id: 'plex',
    name: 'Plex',
    capabilities: ['topArtists', 'recentListening'],

    async getTopArtists(limit) {
      const artists = await client.getTopArtists(limit)
      return artists.map((a) => ({
        name: a.name,
        playCount: a.viewCount,
        source: 'plex',
      }))
    },

    async getSimilarArtists() {
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
        playedAt: new Date(t.viewedAt),
      }))
    },
  }
}
