// Apple's public iTunes Search API, asked from the server so that previews
// never make the browser contact Apple. It needs no account or key.

import { createHttpClient } from './http'

const DEFAULT_BASE_URL = 'https://itunes.apple.com'
/** Apple serves 30-second clips from this host only; other preview URLs are dropped. */
export const APPLE_PREVIEW_HOST = 'https://audio-ssl.itunes.apple.com/'
// Whole-lookup budget: short enough that playback still follows the user's click.
const LOOKUP_BUDGET_MS = 4000
// Wide enough to see every artist with the same name, so duplicates are refused.
const ARTIST_SEARCH_LIMIT = 25
const SONG_LIMIT = 10
const CACHE_TTL_MS = 6 * 60 * 60 * 1000
const NO_MATCH_TTL_MS = 60 * 60 * 1000
const CACHE_MAX_ENTRIES = 500
const ARTIST_ID_PATTERN = /^\d{1,15}$/

export type AppleSong = {
  trackId: number
  trackName?: string
  artistName?: string
  /** Only present when it is a clip on APPLE_PREVIEW_HOST. */
  previewUrl?: string
}

export type AppleSongLookup =
  | { songs: AppleSong[]; reason?: undefined }
  | { songs: null; reason: 'lookup-failed' | 'no-match' }

type RawResults = { results?: unknown }
type RawArtist = { artistId?: unknown; artistName?: unknown }
type RawSong = {
  wrapperType?: unknown
  kind?: unknown
  trackId?: unknown
  trackName?: unknown
  artistName?: unknown
  previewUrl?: unknown
}

export const normalizeArtistName = (name: string) =>
  name.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase()

function resultsOf<T>(body: RawResults): T[] | null {
  return Array.isArray(body?.results) ? (body.results as T[]) : null
}

// Keep only the fields the client needs, and only a clip from Apple's preview host.
function toSong(raw: RawSong): AppleSong | null {
  if (raw.wrapperType !== 'track' || raw.kind !== 'song') return null
  if (typeof raw.trackId !== 'number' || !Number.isSafeInteger(raw.trackId) || raw.trackId <= 0)
    return null
  return {
    trackId: raw.trackId,
    ...(typeof raw.trackName === 'string' ? { trackName: raw.trackName } : {}),
    ...(typeof raw.artistName === 'string' ? { artistName: raw.artistName } : {}),
    ...(typeof raw.previewUrl === 'string' && raw.previewUrl.startsWith(APPLE_PREVIEW_HOST)
      ? { previewUrl: raw.previewUrl }
      : {}),
  }
}

export function createItunesClient(config?: {
  baseUrl?: string
  budgetMs?: number
  now?: () => number
}) {
  const budgetMs = config?.budgetMs ?? LOOKUP_BUDGET_MS
  const now = config?.now ?? Date.now
  // No redirects are followed and no retries made: one fixed host, one attempt.
  const http = createHttpClient({
    baseUrl: config?.baseUrl ?? DEFAULT_BASE_URL,
    headers: { Accept: 'application/json' },
    retries: 0,
    timeout: budgetMs,
  })
  const cache = new Map<string, { lookup: AppleSongLookup; expiresAt: number }>()

  function remember(key: string, lookup: AppleSongLookup) {
    if (lookup.reason === 'lookup-failed') return
    cache.delete(key)
    cache.set(key, {
      lookup,
      expiresAt: now() + (lookup.songs ? CACHE_TTL_MS : NO_MATCH_TTL_MS),
    })
    while (cache.size > CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
  }

  async function get(path: string, deadline: number): Promise<RawResults> {
    const timeout = deadline - now()
    if (timeout <= 0) throw new Error('Apple lookup budget exhausted')
    return http.get<RawResults>(path, { timeout })
  }

  // Exactly one artist with this name, or none: there are several artists
  // called Nirvana, and a bare name also matches covers and tributes.
  async function findArtistId(artistName: string, deadline: number): Promise<string | null> {
    const params = new URLSearchParams({
      term: artistName,
      media: 'music',
      entity: 'musicArtist',
      attribute: 'artistTerm',
      limit: String(ARTIST_SEARCH_LIMIT),
    })
    const artists = resultsOf<RawArtist>(await get(`/search?${params.toString()}`, deadline))
    if (!artists) throw new Error('Unexpected Apple search response')
    const wanted = normalizeArtistName(artistName)
    const ids = new Set<number>()
    for (const artist of artists) {
      if (
        typeof artist?.artistId === 'number' &&
        Number.isSafeInteger(artist.artistId) &&
        artist.artistId > 0 &&
        typeof artist.artistName === 'string' &&
        normalizeArtistName(artist.artistName) === wanted
      ) {
        ids.add(artist.artistId)
      }
    }
    if (ids.size !== 1) return null
    return String([...ids][0])
  }

  /**
   * The artist's songs, most popular first. With an Apple artist ID (from a
   * MusicBrainz Apple Music link) the songs are looked up directly. Otherwise
   * the artist is searched by name, and used only when exactly one artist has
   * exactly that name. The search is over artists, not songs: Apple credits
   * songs under a romanized name for some artists it lists in their own script.
   */
  async function lookupSongs(query: {
    artistName: string
    artistId?: string
  }): Promise<AppleSongLookup> {
    const artistId =
      query.artistId && ARTIST_ID_PATTERN.test(query.artistId) ? query.artistId : undefined
    const key = artistId ? `id:${artistId}` : `name:${normalizeArtistName(query.artistName)}`
    const cached = cache.get(key)
    if (cached && cached.expiresAt > now()) return cached.lookup
    if (cached) cache.delete(key)

    const deadline = now() + budgetMs
    let lookup: AppleSongLookup
    try {
      const id = artistId ?? (await findArtistId(query.artistName, deadline))
      if (!id) {
        lookup = { songs: null, reason: 'no-match' }
      } else {
        const params = new URLSearchParams({ id, entity: 'song', limit: String(SONG_LIMIT) })
        const results = resultsOf<RawSong>(await get(`/lookup?${params.toString()}`, deadline))
        if (!results) throw new Error('Unexpected Apple lookup response')
        const songs = results.flatMap((raw) => {
          const song = raw && typeof raw === 'object' ? toSong(raw) : null
          return song ? [song] : []
        })
        lookup = songs.length > 0 ? { songs } : { songs: null, reason: 'no-match' }
      }
    } catch {
      lookup = { songs: null, reason: 'lookup-failed' }
    }
    remember(key, lookup)
    return lookup
  }

  return { lookupSongs }
}

export type ItunesClient = ReturnType<typeof createItunesClient>
