import type { RadioMode, TagRadioInput } from '@/core/clients/listenbrainz'
import { createListenBrainzClient } from '@/core/clients/listenbrainz'
import { createMusicBrainzClient } from '@/core/clients/musicbrainz'
import { resolveTagRadioRecordings } from '@/core/clients/tag-radio-resolver'
import { deduplicateByName } from '@/core/subscriptions/dedup'
import type { AdapterResult, SubscriptionAdapter } from '@/core/subscriptions/types'

type FreshRelease = {
  artist_credit_name?: string
  release_mbid?: string
}

type FreshReleasesPayload = {
  payload?: {
    releases?: FreshRelease[]
  }
}

type JspfTrackExtension = {
  additional_metadata?: { artists?: Array<{ artist_credit_name?: string; artist_mbid?: string }> }
  artist_identifiers?: string[]
}

type JspfTrack = {
  creator?: string
  title?: string
  identifier?: string | string[]
  extension?: Record<string, JspfTrackExtension | undefined>
}

type JspfPlaylist = {
  title?: string
  date?: string
  identifier?: string
  track?: JspfTrack[]
}

type JspfResponse = {
  playlist?: JspfPlaylist
}

type UserPlaylistsResponse = {
  playlists?: JspfResponse[]
}

const JSPF_TRACK_EXT = 'https://musicbrainz.org/doc/jspf#track'
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i

const LB_BASE = 'https://api.listenbrainz.org/1'

export function createListenBrainzAdapter(deps: {
  username: string
  token: string
}): SubscriptionAdapter {
  return {
    type: 'listenbrainz',
    async fetch(
      config: Record<string, unknown>,
      options?: { limit?: number },
    ): Promise<AdapterResult> {
      const result = await fetchFeed(deps, config)
      const limit = options?.limit
      return limit && limit > 0 ? { ...result, artists: result.artists.slice(0, limit) } : result
    },
  }
}

async function fetchFeed(
  deps: { username: string; token: string },
  config: Record<string, unknown>,
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
}

async function fetchListenBrainz(url: string, token: string, feed: string): Promise<Response> {
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
    throw new Error(`ListenBrainz ${feed} fetch failed: ${res.status} ${res.statusText}`)
  }
  return res
}

async function fetchFreshReleases(token: string): Promise<AdapterResult> {
  const res = await fetchListenBrainz(
    `${LB_BASE}/explore/fresh-releases?days=14`,
    token,
    'fresh-releases',
  )
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

/** Newest created-for playlist whose title starts with `titlePrefix`, by its date, not list order. */
function pickNewestPlaylist(
  entries: JspfResponse[],
  titlePrefix: string,
): JspfPlaylist | undefined {
  const prefix = titlePrefix.toLowerCase()
  const time = (p: JspfPlaylist) => Date.parse(p.date ?? '') || 0
  return entries
    .flatMap((e) => (e.playlist?.title?.toLowerCase().startsWith(prefix) ? [e.playlist] : []))
    .sort((a, b) => time(b) - time(a))[0]
}

function mbidFromUrl(value: string | undefined): string | undefined {
  return value && UUID_RE.test(value) ? value.match(UUID_RE)?.[0]?.toLowerCase() : undefined
}

function mapJspfTrack(t: JspfTrack) {
  const ext = t.extension?.[JSPF_TRACK_EXT]
  const credit = ext?.additional_metadata?.artists?.[0]
  const name = credit?.artist_credit_name?.trim() || t.creator?.trim()
  if (!name) return null
  const artistMbid = mbidFromUrl(ext?.artist_identifiers?.[0]) ?? mbidFromUrl(credit?.artist_mbid)
  const identifier = Array.isArray(t.identifier) ? t.identifier[0] : t.identifier
  const recordingMbid = identifier?.includes('/recording/') ? mbidFromUrl(identifier) : undefined
  return { name, artistMbid, recordingMbid, recordingTitle: t.title?.trim() }
}

async function fetchWeeklyJams(username: string, token: string): Promise<AdapterResult> {
  // Weekly Jams are created for the user by ListenBrainz, so they are not in /playlists, and
  // the list endpoints return empty track arrays; tracks come from the playlist itself.
  const listRes = await fetchListenBrainz(
    `${LB_BASE}/user/${encodeURIComponent(username)}/playlists/createdfor`,
    token,
    'weekly-jams',
  )
  const list = (await listRes.json()) as UserPlaylistsResponse
  const newest = pickNewestPlaylist(list.playlists ?? [], 'Weekly Jams')
  const playlistMbid = mbidFromUrl(newest?.identifier)
  if (!playlistMbid) {
    return {
      artists: [],
      message: 'ListenBrainz has not generated a Weekly Jams playlist for this account yet.',
    }
  }

  const res = await fetchListenBrainz(`${LB_BASE}/playlist/${playlistMbid}`, token, 'weekly-jams')
  const data = (await res.json()) as JspfResponse
  const tracks = (data.playlist?.track ?? []).flatMap((t) => {
    const mapped = mapJspfTrack(t)
    return mapped ? [mapped] : []
  })

  const artists = deduplicateByName(tracks, (t) => ({
    name: t.name,
    ...(t.artistMbid ? { mbid: t.artistMbid } : {}),
    similarityScore: 0.6,
    source: 'listenbrainz:weekly-jams',
    ...(t.artistMbid && t.recordingMbid && t.recordingTitle
      ? { recordingMbid: t.recordingMbid, recordingTitle: t.recordingTitle }
      : {}),
  }))

  return { artists }
}
