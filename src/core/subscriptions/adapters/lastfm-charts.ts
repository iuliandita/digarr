import { deduplicateByName, normalizeListenerScore } from '@/core/subscriptions/dedup'
import type { AdapterResult, SubscriptionAdapter } from '@/core/subscriptions/types'

type LastfmArtistEntry = {
  name: string
  mbid?: string
  listeners?: string
  playcount?: string
}

type LastfmChartsResponse = {
  artists?: {
    artist?: LastfmArtistEntry[]
  }
}

export function createLastfmChartsAdapter(deps: { apiKey: string }): SubscriptionAdapter {
  return {
    type: 'lastfm-charts',
    label: 'Last.fm Charts',
    configFields: [],

    async fetch(
      _config: Record<string, unknown>,
      options?: { limit?: number },
    ): Promise<AdapterResult> {
      const limit = options?.limit ?? 50

      const url = `https://ws.audioscrobbler.com/2.0/?method=chart.gettopartists&api_key=${deps.apiKey}&format=json&limit=${limit}`

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 10_000)
      let res: Response
      try {
        res = await fetch(url, { signal: controller.signal })
      } finally {
        clearTimeout(timer)
      }
      if (!res.ok) {
        throw new Error(`Last.fm charts fetch failed: ${res.status} ${res.statusText}`)
      }

      const data = (await res.json()) as LastfmChartsResponse
      const entries = data.artists?.artist ?? []

      const artists = deduplicateByName(entries, (entry) => ({
        name: entry.name,
        mbid: entry.mbid || undefined,
        similarityScore: normalizeListenerScore(entry.listeners ?? entry.playcount),
        source: 'lastfm-charts',
      }))

      return { artists }
    },
  }
}
