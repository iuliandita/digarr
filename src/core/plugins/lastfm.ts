import { createLastFmClient } from '@/core/clients/lastfm'
import type { DiscoverySource } from './types'

export function createLastFmSource(username: string, apiKey: string): DiscoverySource {
  const client = createLastFmClient(username, apiKey)

  return {
    id: 'lastfm',
    name: 'Last.fm',
    capabilities: ['topArtists', 'similarArtists', 'genreArtists'],

    async getTopArtists() {
      const artists = await client.getTopArtists('1month')
      return artists.map((a) => ({
        name: a.name,
        mbid: a.mbid,
        playCount: a.playCount,
        source: 'lastfm',
      }))
    },

    async getSimilarArtists(artistName, mbid) {
      const similar = await client.getSimilarArtists(artistName, mbid)
      return similar.map((s) => ({
        name: s.name,
        mbid: s.mbid,
        similarityScore: s.similarityScore,
        source: 'lastfm',
      }))
    },

    async testConnection() {
      return client.testConnection()
    },

    async getGenreArtists(genre, options) {
      const artists = await client.getTopArtistsByTag(genre, options?.limit)
      return artists.map((a) => ({
        name: a.name,
        mbid: a.mbid,
        listeners: a.listeners,
        source: 'lastfm',
      }))
    },

    getArtistGenres(artistName, mbid) {
      return client.getArtistTopTags(artistName, mbid)
    },
  }
}
