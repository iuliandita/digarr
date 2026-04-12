import type { RadioMode, TagRadioInput } from '@/core/clients/listenbrainz'
import { createListenBrainzClient } from '@/core/clients/listenbrainz'
import { createMusicBrainzClient } from '@/core/clients/musicbrainz'
import { resolveTagRadioRecordings } from '@/core/clients/tag-radio-resolver'
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
      { value: 'artist-radio', label: 'Artist Radio' },

      { value: 'similar-users', label: 'Similar Users' },
      { value: 'tag-radio', label: 'Tag Radio' },
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

      if (feedType === 'artist-radio') {
        return fetchArtistRadio(deps, config)
      }

      if (feedType === 'similar-users') {
        return fetchSimilarUsers(deps, config)
      }

      if (feedType === 'tag-radio') {
        return fetchTagRadio(deps, config)
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

async function fetchArtistRadio(
  deps: { username: string; token: string },
  config: Record<string, unknown>,
): Promise<AdapterResult> {
  const client = createListenBrainzClient(deps.username, deps.token)
  const mbid = String(config.seedArtistMbid ?? '')
  const mode = (config.adventurousness as RadioMode) ?? 'medium'
  if (!mbid) return { artists: [] }
  const radio = await client.getArtistRadio(mbid, mode)
  return {
    artists: radio.map((a) => ({
      name: a.name,
      similarityScore: a.score,
      source: 'listenbrainz:artist-radio',
    })),
  }
}

async function fetchSimilarUsers(
  deps: { username: string; token: string },
  config: Record<string, unknown>,
): Promise<AdapterResult> {
  const client = createListenBrainzClient(deps.username, deps.token)
  const maxUsers = Math.min(Math.max(1, Number(config.maxUsers) || 3), 10)
  const similarUsers = await client.getSimilarUsers()
  const topUsers = similarUsers.slice(0, maxUsers)

  const seen = new Set<string>()
  const artists: AdapterResult['artists'] = []

  for (const simUser of topUsers) {
    const topArtists = await client.getTopArtistsForUser(simUser.username, 'month')
    for (const artist of topArtists) {
      const key = artist.name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      artists.push({
        name: artist.name,
        similarityScore: simUser.similarity * 0.8,
        source: 'listenbrainz:similar-users',
      })
    }
  }

  return { artists }
}

async function fetchTagRadio(
  deps: { username: string; token: string },
  config: Record<string, unknown>,
): Promise<AdapterResult> {
  const client = createListenBrainzClient(deps.username, deps.token)

  const rawExpr = String(config.rawTagExpression ?? '').trim()
  let tags: TagRadioInput[]
  if (rawExpr) {
    const pattern = /\(([^)]+)\):(\d+)/g
    const results: TagRadioInput[] = []
    for (const matchResult of rawExpr.matchAll(pattern)) {
      results.push({ tag: String(matchResult[1]), weight: Number(matchResult[2]) })
    }
    tags = results.length > 0 ? results : [{ tag: rawExpr, weight: 1 }]
  } else {
    const tagsRaw = config.tags
    type TagEntry = { tag?: unknown; weight?: unknown }
    tags = Array.isArray(tagsRaw)
      ? (tagsRaw as TagEntry[])
          .filter((t) => String(t.tag ?? '').trim())
          .map((t) => ({ tag: String(t.tag).trim(), weight: Number(t.weight) || 1 }))
      : []
  }

  if (tags.length === 0) return { artists: [] }

  const count = Number(config.count) || 25
  const recordings = await client.getTagRadio(tags, { count })

  const { db } = await import('@/db')
  const mbClient = createMusicBrainzClient()
  const resolved = await resolveTagRadioRecordings(recordings, mbClient, db)

  return {
    artists: resolved.map((a) => ({
      name: a.artistName,
      similarityScore: a.score,
      source: 'listenbrainz:tag-radio',
    })),
  }
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
