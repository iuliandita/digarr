import type { AdapterResult, SubscriptionAdapter } from '@/core/subscriptions/types'
import { deduplicateByName } from '../dedup'

type SpotifySavedTrackResponse = {
  items?: Array<{
    track?: {
      artists?: Array<{ name: string; id: string }>
    } | null
  }>
  next?: string | null
}

const SOURCE_URL = 'https://open.spotify.com/collection/tracks'
const PAGE_SIZE = 50

export function createSpotifyLikedSongsAdapter(deps: {
  getToken: () => Promise<string>
  baseUrl?: string
}): SubscriptionAdapter {
  const baseUrl = deps.baseUrl ?? 'https://api.spotify.com/v1'

  return {
    type: 'spotify-liked-songs',
    label: 'Spotify Liked Songs',
    configFields: [],

    async fetch(
      _config: Record<string, unknown>,
      options?: { limit?: number },
    ): Promise<AdapterResult> {
      const limit = Math.max(1, options?.limit ?? 100)
      const token = await deps.getToken()
      const entries: Array<{ name: string }> = []
      let offset = 0
      let hasNext = true

      while (hasNext) {
        const uniqueCount = new Set(entries.map((entry) => entry.name.toLowerCase())).size
        if (uniqueCount >= limit) break

        const pageLimit = PAGE_SIZE
        const params = new URLSearchParams({
          limit: String(pageLimit),
          offset: String(offset),
        })

        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 10_000)
        let res: Response
        try {
          res = await fetch(`${baseUrl}/me/tracks?${params}`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
          })
        } finally {
          clearTimeout(timer)
        }

        if (!res.ok) {
          throw new Error(`Spotify liked songs fetch failed: ${res.status} ${res.statusText}`)
        }

        const data = (await res.json()) as SpotifySavedTrackResponse
        const pageEntries = (data.items ?? []).flatMap((item) =>
          (item.track?.artists ?? []).map((artist) => ({ name: artist.name })),
        )

        entries.push(...pageEntries)
        hasNext = Boolean(data.next) && pageEntries.length > 0
        offset += pageLimit
      }

      const artists = deduplicateByName(entries, (entry) => ({
        name: entry.name,
        similarityScore: 0.85,
        source: 'spotify-liked-songs',
        sourceUrl: SOURCE_URL,
      }))

      return { artists: artists.slice(0, limit) }
    },
  }
}
