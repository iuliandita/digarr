import { deduplicateByName, normalizeListenerScore } from '@/core/subscriptions/dedup'
import type {
  AdapterConfigField,
  AdapterResult,
  SubscriptionAdapter,
} from '@/core/subscriptions/types'

const CONFIG_FIELDS: AdapterConfigField[] = [
  {
    key: 'tag',
    label: 'Tag',
    type: 'text',
    required: true,
    placeholder: 'e.g. metal',
    helpText: 'Last.fm tag to fetch top artists for.',
  },
]

type LastfmArtistEntry = {
  name: string
  mbid?: string
  listeners?: string
}

type LastfmTagResponse = {
  topartists?: {
    artist?: LastfmArtistEntry[]
  }
}

export function createLastfmTagAdapter(deps: { apiKey: string }): SubscriptionAdapter {
  return {
    type: 'lastfm-tag',
    label: 'Last.fm Tag',
    configFields: CONFIG_FIELDS,

    async fetch(
      config: Record<string, unknown>,
      options?: { limit?: number },
    ): Promise<AdapterResult> {
      const tag = String(config.tag ?? '').trim()
      if (!tag) return { artists: [] }

      const limit = options?.limit ?? 50
      const url = `https://ws.audioscrobbler.com/2.0/?method=tag.gettopartists&tag=${encodeURIComponent(tag)}&api_key=${deps.apiKey}&format=json&limit=${limit}`

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 10_000)
      let res: Response
      try {
        res = await fetch(url, { signal: controller.signal })
      } finally {
        clearTimeout(timer)
      }
      if (!res.ok) {
        throw new Error(`Last.fm tag fetch failed: ${res.status} ${res.statusText}`)
      }

      const data = (await res.json()) as LastfmTagResponse
      const entries = data.topartists?.artist ?? []

      const artists = deduplicateByName(entries, (entry) => ({
        name: entry.name,
        mbid: entry.mbid || undefined,
        similarityScore: normalizeListenerScore(entry.listeners),
        source: `lastfm-tag:${tag}`,
      }))

      return { artists }
    },
  }
}
