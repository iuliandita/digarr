import { createDiscogsClient } from '@/core/clients/discogs'
import type { DiscoverySource } from './types'

export function createDiscogsSource(token: string, username: string): DiscoverySource {
  const client = createDiscogsClient(token, username)

  return {
    id: 'discogs',
    name: 'Discogs',
    capabilities: ['topArtists', 'genreArtists'],

    async getTopArtists(limit) {
      const [collection, wantlist] = await Promise.all([
        client.getCollectionArtists(limit),
        client.getWantlistArtists(limit),
      ])

      // Merge: dedupe by lowercase name, add counts for overlap
      const merged = new Map<string, { name: string; count: number; genres: string[] }>()

      for (const artist of collection) {
        const key = artist.name.toLowerCase()
        merged.set(key, { name: artist.name, count: artist.count, genres: artist.genres })
      }

      for (const artist of wantlist) {
        const key = artist.name.toLowerCase()
        const existing = merged.get(key)
        if (existing) {
          existing.count += artist.count
          existing.genres = [...new Set([...existing.genres, ...artist.genres])]
        } else {
          merged.set(key, { name: artist.name, count: artist.count, genres: artist.genres })
        }
      }

      return [...merged.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, limit)
        .map((a) => ({
          name: a.name,
          playCount: a.count,
          source: 'discogs',
          ...(a.genres.length > 0 ? { genres: a.genres, genreSource: 'native' as const } : {}),
        }))
    },

    async getSimilarArtists() {
      return []
    },

    async testConnection() {
      return client.testConnection()
    },

    async getGenreArtists(genre, options) {
      const results = await client.searchByGenre(genre, options?.limit)
      return results.map((a) => ({
        name: a.name,
        listeners: 0,
        source: 'discogs',
      }))
    },
  }
}
