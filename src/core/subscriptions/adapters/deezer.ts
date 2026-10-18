import { createDeezerUserClient } from '@/core/clients/deezer-user'
import type { AdapterResult, SubscriptionAdapter } from '@/core/subscriptions/types'
import { deduplicateByName } from '../dedup'

const MAX_PLAYLIST_ARTISTS = 500

export function createDeezerAdapter(deps: {
  getToken: () => Promise<string>
}): SubscriptionAdapter {
  return {
    type: 'deezer',
    async fetch(
      config: Record<string, unknown>,
      options?: { limit?: number },
    ): Promise<AdapterResult> {
      const token = await deps.getToken()

      const client = createDeezerUserClient(token)
      const limit = options?.limit

      const feedType = String(config.feedType ?? '')

      switch (feedType) {
        case 'favorites': {
          const raw = await client.getFavoriteArtists(limit)
          const artists = deduplicateByName(raw, (a) => ({
            name: a.name,
            similarityScore: 0.85,
            source: 'deezer:favorites',
          }))
          return { artists }
        }

        case 'followed': {
          const raw = await client.getFollowedArtists(limit)
          const artists = deduplicateByName(raw, (a) => ({
            name: a.name,
            similarityScore: 0.8,
            source: 'deezer:followed',
          }))
          return { artists }
        }

        case 'flow': {
          const raw = await client.getFlowRecommendations(limit)
          const artists = deduplicateByName(raw, (a) => ({
            name: a.name,
            similarityScore: 0.7,
            source: 'deezer:flow',
          }))
          return { artists }
        }

        case 'playlists': {
          const rawIds = String(config.playlistIds ?? '')
          const playlistIds = rawIds
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .map(Number)
            .filter((n) => !Number.isNaN(n) && n > 0)

          if (playlistIds.length === 0) return { artists: [] }

          const seen = new Set<string>()
          const names: string[] = []

          for (const id of playlistIds) {
            if (names.length >= MAX_PLAYLIST_ARTISTS) break
            const tracks = await client.getPlaylistTracks(id)
            for (const name of tracks) {
              if (names.length >= MAX_PLAYLIST_ARTISTS) break
              const key = name.toLowerCase()
              if (seen.has(key)) continue
              seen.add(key)
              names.push(name)
            }
          }

          const artists = names.map((name) => ({
            name,
            similarityScore: 0.6,
            source: 'deezer:playlists',
          }))

          return { artists }
        }

        default:
          return { artists: [] }
      }
    },
  }
}
