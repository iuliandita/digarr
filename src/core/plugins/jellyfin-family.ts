import type { ServiceTestResult } from '@/core/types'
import type { DiscoverySource } from './types'

type JellyfinFamilyClient = {
  getTopArtists(
    limit?: number,
  ): Promise<Array<{ name: string; mbid?: string; genres: string[]; playCount: number }>>
  getFavoriteArtists(
    limit?: number,
  ): Promise<Array<{ name: string; mbid?: string; genres: string[]; playCount: number }>>
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
      const merged = new Map<
        string,
        { name: string; mbid?: string; genres: string[]; playCount: number }
      >()

      for (const artist of topByPlays) {
        const genres = artist.genres ?? []
        merged.set(artist.name.toLowerCase(), {
          name: artist.name,
          mbid: artist.mbid,
          genres,
          playCount: artist.playCount,
        })
      }

      for (const favorite of favorites) {
        const key = favorite.name.toLowerCase()
        const existing = merged.get(key)
        if (existing) {
          existing.playCount = Math.round(existing.playCount * 1.2)
          existing.mbid ??= favorite.mbid
          existing.genres = [...new Set([...existing.genres, ...(favorite.genres ?? [])])]
        } else {
          merged.set(key, {
            name: favorite.name,
            mbid: favorite.mbid,
            genres: favorite.genres ?? [],
            playCount: Math.max(favorite.playCount, 1),
          })
        }
      }

      return Array.from(merged.values())
        .sort((a, b) => b.playCount - a.playCount)
        .slice(0, limit ?? 50)
        .map((artist) => ({
          name: artist.name,
          playCount: artist.playCount,
          source: id,
          ...(artist.mbid ? { mbid: artist.mbid } : {}),
          ...(artist.genres.length > 0
            ? { genres: artist.genres, genreSource: 'native' as const }
            : {}),
        }))
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
