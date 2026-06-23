import { createSpotifyClient } from '@/core/clients/spotify'
import type { DiscoverySource } from './types'

export function createSpotifySource(accessToken: string): DiscoverySource {
  const client = createSpotifyClient(accessToken)

  return {
    id: 'spotify',
    name: 'Spotify',
    capabilities: ['topArtists', 'recentListening'],

    async getTopArtists(limit) {
      const artists = await client.getTopArtists('medium_term', limit)
      return artists.map((a) => ({
        name: a.name,
        playCount: a.popularity,
        source: 'spotify',
        genres: a.genres ?? [],
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
