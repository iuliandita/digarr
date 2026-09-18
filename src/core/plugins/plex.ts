import { createPlexClient } from '@/core/clients/plex'
import type { DiscoverySource } from './types'

export function createPlexSource(
  url: string,
  token: string,
  sectionId?: string | null,
  accountId?: number | null,
  machineIdentifier?: string | null,
): DiscoverySource {
  const client = createPlexClient(url, token, { sectionId, accountId, machineIdentifier })
  const artistRatingKeys = new Map<string, string>()

  function rememberArtist(name: string, ratingKey: string): void {
    artistRatingKeys.set(name.trim().toLocaleLowerCase(), ratingKey)
  }

  function mbidFromGuid(guid: string): string | undefined {
    const match = guid.match(
      /(?:musicbrainz|mbid):(?:\/\/)?(?:artist\/)?([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i,
    )
    return match?.[1]
  }

  return {
    id: 'plex',
    name: 'Plex',
    capabilities: ['topArtists', 'similarArtists', 'recentListening'],

    async getTopArtists(limit) {
      const artists = await client.getTopArtists(limit)
      return artists.map((artist) => {
        rememberArtist(artist.name, artist.ratingKey)
        return {
          name: artist.name,
          playCount: artist.viewCount,
          source: 'plex',
          ...((artist.genres ?? []).length > 0
            ? { genres: artist.genres, genreSource: 'native' as const }
            : {}),
        }
      })
    },

    async getSimilarArtists(artistName) {
      const ratingKey = artistRatingKeys.get(artistName.trim().toLocaleLowerCase())
      if (!ratingKey) return []
      const similar = await client.getSimilarArtists(ratingKey)
      const count = Math.max(1, similar.length)
      return similar.map((artist, index) => ({
        name: artist.name,
        mbid: mbidFromGuid(artist.guid),
        similarityScore: Math.max(0.1, 1 - index / count),
        source: 'plex',
      }))
    },

    async testConnection() {
      return client.testConnection()
    },

    async getRecentListening(limit) {
      const tracks = await client.getRecentlyPlayed(limit)
      return tracks.map((track) => {
        rememberArtist(track.artistName, track.artistRatingKey)
        return {
          name: track.artistName,
          track: track.trackName,
          playedAt: new Date(track.viewedAt),
        }
      })
    },
  }
}
