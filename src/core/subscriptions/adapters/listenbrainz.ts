import { deduplicateByName } from '@/core/subscriptions/dedup'
import type {
  AdapterConfigField,
  AdapterResult,
  SubscriptionAdapter,
} from '@/core/subscriptions/types'

const CONFIG_FIELDS: AdapterConfigField[] = [
  {
    key: 'feedType',
    label: 'Feed Type',
    type: 'select',
    required: true,
    options: [
      { value: 'fresh-releases', label: 'Fresh Releases' },
      { value: 'weekly-jams', label: 'Weekly Jams' },
    ],
    helpText: 'Which ListenBrainz feed to pull artists from.',
  },
]

type FreshRelease = {
  artist_credit_name?: string
  release_mbid?: string
}

type FreshReleasesPayload = {
  payload?: {
    releases?: FreshRelease[]
  }
}

type JspfTrack = {
  creator?: string
  title?: string
}

type JspfPlaylist = {
  title?: string
  track?: JspfTrack[]
}

type JspfResponse = {
  playlist?: JspfPlaylist
}

type UserPlaylistsResponse = {
  playlists?: JspfResponse[]
}

const LB_BASE = 'https://api.listenbrainz.org/1'

export function createListenBrainzAdapter(deps: {
  username: string
  token: string
}): SubscriptionAdapter {
  return {
    type: 'listenbrainz',
    label: 'ListenBrainz',
    configFields: CONFIG_FIELDS,

    async fetch(
      config: Record<string, unknown>,
      _options?: { limit?: number },
    ): Promise<AdapterResult> {
      const feedType = String(config.feedType ?? 'fresh-releases').trim()

      if (feedType === 'fresh-releases') {
        return fetchFreshReleases(deps.token)
      }

      if (feedType === 'weekly-jams') {
        return fetchWeeklyJams(deps.username, deps.token)
      }

      return { artists: [] }
    },
  }
}

async function fetchFreshReleases(token: string): Promise<AdapterResult> {
  const url = `${LB_BASE}/explore/fresh-releases?days=14`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  let res: Response
  try {
    res = await fetch(url, {
      headers: { Authorization: `Token ${token}` },
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    throw new Error(`ListenBrainz fresh-releases fetch failed: ${res.status} ${res.statusText}`)
  }

  const data = (await res.json()) as FreshReleasesPayload
  const releases = (data.payload?.releases ?? []).flatMap((r) =>
    r.artist_credit_name ? [{ name: r.artist_credit_name }] : [],
  )

  const artists = deduplicateByName(releases, (r) => ({
    name: r.name,
    similarityScore: 0.6,
    source: 'listenbrainz:fresh-releases',
  }))

  return { artists }
}

async function fetchWeeklyJams(username: string, token: string): Promise<AdapterResult> {
  const url = `${LB_BASE}/user/${encodeURIComponent(username)}/playlists`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  let res: Response
  try {
    res = await fetch(url, {
      headers: { Authorization: `Token ${token}` },
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    throw new Error(`ListenBrainz weekly-jams fetch failed: ${res.status} ${res.statusText}`)
  }

  const data = (await res.json()) as UserPlaylistsResponse
  const playlists = data.playlists ?? []

  const jamsEntry = playlists.find((p) => p.playlist?.title?.toLowerCase().includes('weekly jams'))

  if (!jamsEntry?.playlist) return { artists: [] }

  const tracks = (jamsEntry.playlist.track ?? []).flatMap((t) =>
    t.creator ? [{ name: t.creator }] : [],
  )

  const artists = deduplicateByName(tracks, (t) => ({
    name: t.name,
    similarityScore: 0.6,
    source: 'listenbrainz:weekly-jams',
  }))

  return { artists }
}
