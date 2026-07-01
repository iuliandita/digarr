import { createSubsonicClient } from '@/core/clients/subsonic'
import type { DiscoverySource } from './types'

export function createSubsonicSource(
  url: string,
  username: string,
  password: string,
  skipTlsVerify?: boolean,
): DiscoverySource {
  const client = createSubsonicClient(url, username, password, { skipTlsVerify })

  return {
    id: 'subsonic',
    name: 'Subsonic',
    capabilities: ['topArtists'],

    async getTopArtists(limit) {
      const artists = await client.getStarredArtists()
      const sliced = typeof limit === 'number' ? artists.slice(0, limit) : artists
      return sliced.map((a, i) => ({
        name: a.name,
        playCount: sliced.length - i,
        source: 'subsonic',
      }))
    },

    async getSimilarArtists() {
      return []
    },

    async testConnection() {
      return client.testConnection()
    },
  }
}
