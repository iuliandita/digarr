import type {
  AdapterConfigField,
  AdapterResult,
  SubscriptionAdapter,
} from '@/core/subscriptions/types'
import type { DiscoveredArtist } from '@/core/types'
import { extractArtistsFromPlaylist, type SpotifyTrackItem } from './spotify-shared'

const CONFIG_FIELDS: AdapterConfigField[] = [
  {
    key: 'playlistId',
    label: 'Playlist ID or URL',
    type: 'text',
    required: true,
    placeholder: 'e.g. 37i9dQZEVXbMDoHDwVN2tF or open.spotify.com/playlist/...',
    helpText: 'Spotify playlist URL, URI, or bare ID.',
  },
]

const PAGE_SIZE = 50
const MAX_PAGES = 20

function extractPlaylistId(raw: string): string {
  const id = raw.startsWith('spotify:playlist:')
    ? raw.slice('spotify:playlist:'.length)
    : (raw.match(
        /^(?:https?:\/\/)?open\.spotify\.com\/playlist\/([A-Za-z0-9]+)(?:[?#].*)?$/,
      )?.[1] ?? raw)
  if (!/^[A-Za-z0-9]+$/.test(id)) {
    throw new Error('Spotify playlist ID must be an alphanumeric ID, Spotify URL, or URI')
  }
  return id
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parsePage(data: unknown): { items: SpotifyTrackItem[]; next: string | null } {
  const malformed = () => new Error('Spotify playlist returned a malformed page')
  if (
    !isRecord(data) ||
    !Array.isArray(data.items) ||
    data.items.length > PAGE_SIZE ||
    (data.next !== null && typeof data.next !== 'string')
  ) {
    throw malformed()
  }
  const items = data.items.map((entry): SpotifyTrackItem => {
    if (!isRecord(entry)) throw malformed()
    const track = Object.hasOwn(entry, 'item') ? entry.item : entry.track
    if (track === null) return { track: null }
    if (!isRecord(track)) throw malformed()
    if (track.type === 'episode') return { track: null }
    if (track.type !== undefined && track.type !== 'track') throw malformed()
    const isLocal = entry.is_local === true || track.is_local === true
    const rawArtists = isLocal && track.artists == null ? [] : track.artists
    if (!Array.isArray(rawArtists)) throw malformed()
    const artists = rawArtists.flatMap((artist) => {
      if (!isRecord(artist)) throw malformed()
      if (
        isLocal &&
        (artist.name == null || (typeof artist.name === 'string' && !artist.name.trim()))
      )
        return []
      if (
        typeof artist.name !== 'string' ||
        !artist.name.trim() ||
        (artist.genres !== undefined &&
          (!Array.isArray(artist.genres) ||
            artist.genres.some((genre) => typeof genre !== 'string')))
      )
        throw malformed()
      return [
        {
          name: artist.name,
          id: typeof artist.id === 'string' ? artist.id : '',
          genres: artist.genres as string[] | undefined,
        },
      ]
    })
    return { track: { artists } }
  })
  return { items, next: data.next }
}

function nextOffset(next: string, endpoint: URL, offset: number, itemCount: number): number {
  const invalid = () => new Error('Spotify playlist returned invalid pagination')
  let url: URL
  try {
    url = new URL(next)
  } catch {
    throw invalid()
  }
  const offsets = url.searchParams.getAll('offset')
  const rawOffset = offsets[0] ?? ''
  const parsed = Number(rawOffset)
  if (
    url.origin !== endpoint.origin ||
    url.pathname !== endpoint.pathname ||
    url.username ||
    url.password ||
    url.hash ||
    offsets.length !== 1 ||
    !/^(0|[1-9][0-9]*)$/.test(rawOffset) ||
    !Number.isSafeInteger(parsed) ||
    parsed <= offset ||
    (parsed !== offset + PAGE_SIZE && parsed !== offset + itemCount)
  ) {
    throw invalid()
  }
  return parsed
}

export function createSpotifyPlaylistAdapter(deps: {
  getToken: () => Promise<string>
  baseUrl?: string
}): SubscriptionAdapter {
  const baseUrl = deps.baseUrl ?? 'https://api.spotify.com/v1'

  return {
    type: 'spotify-playlist',
    label: 'Spotify Playlist',
    configFields: CONFIG_FIELDS,

    async fetch(
      config: Record<string, unknown>,
      options?: { limit?: number },
    ): Promise<AdapterResult> {
      const limit = options?.limit
      if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0)) {
        throw new Error('Spotify playlist artist limit must be a nonnegative integer')
      }
      const rawId = String(config.playlistId ?? '').trim()
      if (!rawId || limit === 0) return { artists: [] }
      const playlistId = extractPlaylistId(rawId)
      const token = await deps.getToken()
      const endpoint = new URL(`${baseUrl.replace(/\/$/, '')}/playlists/${playlistId}/items`)
      const artists: DiscoveredArtist[] = []
      const seen = new Set<string>()
      let offset = 0
      for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber++) {
        const url = new URL(endpoint)
        url.searchParams.set('limit', String(PAGE_SIZE))
        url.searchParams.set('offset', String(offset))
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 10_000)
        let data: unknown
        try {
          const res = await fetch(url, {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
            redirect: 'error',
          })
          if (!res.ok) {
            throw new Error(`Spotify playlist fetch failed: HTTP ${res.status}`)
          }
          try {
            data = await res.json()
          } catch {
            throw new Error('Spotify playlist returned a malformed or unreadable page')
          }
        } catch (error) {
          if (
            error instanceof Error &&
            /^Spotify playlist (fetch failed: HTTP \d{3}|returned a malformed or unreadable page)$/.test(
              error.message,
            )
          )
            throw error
          throw new Error('Spotify playlist request failed or timed out')
        } finally {
          clearTimeout(timer)
        }
        const page = parsePage(data)
        const followingOffset =
          page.next === null ? null : nextOffset(page.next, endpoint, offset, page.items.length)
        const pageArtists = extractArtistsFromPlaylist(
          { tracks: { items: page.items } },
          `spotify-playlist:${playlistId}`,
          `https://open.spotify.com/playlist/${playlistId}`,
        )
        for (const artist of pageArtists) {
          const key = artist.name.toLowerCase()
          if (seen.has(key)) continue
          seen.add(key)
          artists.push(artist)
          if (limit !== undefined && artists.length >= limit) return { artists }
        }
        if (followingOffset === null) return { artists }
        offset = followingOffset
      }
      throw new Error(
        'Spotify playlist scan incomplete after 20 pages; use a smaller artist limit or playlist',
      )
    },
  }
}
