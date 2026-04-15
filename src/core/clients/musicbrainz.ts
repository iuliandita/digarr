import PQueue from 'p-queue'
import { VERSION } from '@/version'

const BASE_URL = 'https://musicbrainz.org/ws/2'
const USER_AGENT = `Digarr/${VERSION} (https://github.com/iuliandita/digarr)`

export type MBArtist = {
  id: string
  name: string
  disambiguation?: string
  'life-span'?: {
    begin?: string
    end?: string
    ended?: boolean
  }
  tags?: Array<{ name: string; count: number }>
  relations?: MBRelation[]
}

/** Extract year from MB date string ("1985", "1985-03", "1985-03-15") */
export function parseYear(dateStr?: string): number | undefined {
  if (!dateStr) return undefined
  const year = Number.parseInt(dateStr.substring(0, 4), 10)
  return Number.isNaN(year) ? undefined : year
}

export type MBRelation = {
  type: string
  url?: { resource: string }
}

export type MBSearchResult = {
  artists: Array<{
    id: string
    name: string
    disambiguation?: string
    tags?: Array<{ name: string; count: number }>
    score: number
  }>
}

export type MBReleaseGroup = {
  id: string
  title: string
  type: string
  firstReleaseDate?: string
}

export type MBRecording = {
  id: string
  title: string
  isrcs?: string[]
}

export type RecordingArtistCredit = {
  recordingMbid: string
  artistMbid: string
  artistName: string
}

type MBRecordingLookup = {
  id: string
  title: string
  'artist-credit'?: Array<{
    artist: { id: string; name: string }
  }>
}

export type StreamingUrls = {
  spotify?: string
  youtube?: string
  appleMusic?: string
  deezer?: string
  tidal?: string
  soundcloud?: string
  bandcamp?: string
}

const STREAMING_PATTERNS: Array<[RegExp, keyof StreamingUrls]> = [
  [/spotify\.com/i, 'spotify'],
  [/music\.youtube\.com/i, 'youtube'],
  [/youtube\.com/i, 'youtube'],
  [/music\.apple\.com/i, 'appleMusic'],
  [/deezer\.com/i, 'deezer'],
  [/tidal\.com/i, 'tidal'],
  [/soundcloud\.com/i, 'soundcloud'],
  [/bandcamp\.com/i, 'bandcamp'],
]

const STREAMING_TYPES = new Set(['streaming music', 'free streaming'])

const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504])
const MAX_RETRIES = 3
const BASE_BACKOFF_MS = 1000
const MAX_RETRY_AFTER_MS = 30_000

function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS)
  }
  // HTTP-date form
  const when = Date.parse(header)
  if (Number.isFinite(when)) {
    return Math.min(Math.max(when - Date.now(), 0), MAX_RETRY_AFTER_MS)
  }
  return null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function createMusicBrainzClient() {
  const queue = new PQueue({ concurrency: 1, interval: 1000, intervalCap: 1 })

  async function fetchOnce(path: string): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    try {
      return await fetch(`${BASE_URL}${path}`, {
        headers: { 'User-Agent': USER_AGENT },
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
  }

  async function requestWithRetry<T>(path: string): Promise<T> {
    let lastErr: unknown
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        const res = await fetchOnce(path)

        if (res.ok) {
          return (await res.json()) as T
        }

        // Non-retryable HTTP status: surface immediately.
        if (!TRANSIENT_STATUSES.has(res.status)) {
          throw new Error(`MusicBrainz HTTP ${res.status} for ${path}`)
        }

        // Transient HTTP status: prefer server-provided Retry-After, else
        // exponential backoff with jitter. Final failed attempt throws out.
        if (attempt === MAX_RETRIES) {
          throw new Error(`MusicBrainz HTTP ${res.status} for ${path}`)
        }
        const retryAfter = parseRetryAfterMs(res.headers.get('retry-after'))
        const backoff = retryAfter ?? BASE_BACKOFF_MS * 2 ** attempt + Math.random() * 250
        console.warn(
          `[musicbrainz] HTTP ${res.status} for ${path} (attempt ${attempt + 1}/${MAX_RETRIES + 1}); retrying in ${Math.round(backoff)}ms`,
        )
        await sleep(backoff)
        lastErr = new Error(`MusicBrainz HTTP ${res.status} for ${path}`)
      } catch (err) {
        // Network/timeout errors are retryable. The final attempt rethrows.
        const retryable =
          err instanceof Error &&
          (err.name === 'AbortError' ||
            err instanceof TypeError ||
            /fetch failed|network|ECONN|ENOTFOUND|ETIMEDOUT|ECONNRESET/i.test(err.message))
        if (!retryable || attempt === MAX_RETRIES) {
          throw err
        }
        const backoff = BASE_BACKOFF_MS * 2 ** attempt + Math.random() * 250
        console.warn(
          `[musicbrainz] ${err instanceof Error ? err.message : String(err)} for ${path} (attempt ${attempt + 1}/${MAX_RETRIES + 1}); retrying in ${Math.round(backoff)}ms`,
        )
        await sleep(backoff)
        lastErr = err
      }
    }
    // Unreachable under normal flow - loop either returns or throws above.
    throw lastErr instanceof Error ? lastErr : new Error(`MusicBrainz request failed for ${path}`)
  }

  async function request<T>(path: string): Promise<T> {
    return queue.add(() => requestWithRetry<T>(path)) as Promise<T>
  }

  function lookupArtist(mbid: string): Promise<MBArtist> {
    const params = new URLSearchParams({ inc: 'tags+url-rels', fmt: 'json' })
    return request<MBArtist>(`/artist/${mbid}?${params}`)
  }

  function searchArtist(query: string): Promise<MBSearchResult> {
    const params = new URLSearchParams({ query, fmt: 'json' })
    return request<MBSearchResult>(`/artist/?${params}`)
  }

  async function getReleaseGroups(artistMbid: string): Promise<MBReleaseGroup[]> {
    const params = new URLSearchParams({
      artist: artistMbid,
      type: 'album|ep|single',
      fmt: 'json',
      limit: '100',
    })
    const data = await request<{
      'release-groups': Array<{
        id: string
        title: string
        'primary-type'?: string
        'first-release-date'?: string
      }>
    }>(`/release-group?${params}`)
    return (data['release-groups'] ?? []).map((rg) => ({
      id: rg.id,
      title: rg.title,
      type: rg['primary-type'] ?? 'Other',
      firstReleaseDate: rg['first-release-date'],
    }))
  }

  async function getRecordings(artistMbid: string, limit = 25): Promise<MBRecording[]> {
    const params = new URLSearchParams({
      artist: artistMbid,
      fmt: 'json',
      limit: String(limit),
    })
    const data = await request<{
      recordings?: Array<{
        id: string
        title: string
        isrcs?: string[]
      }>
    }>(`/recording?${params}`)

    return (data.recordings ?? []).map((recording) => ({
      id: recording.id,
      title: recording.title,
      isrcs: recording.isrcs,
    }))
  }

  async function lookupRecording(mbid: string): Promise<RecordingArtistCredit | null> {
    const params = new URLSearchParams({ inc: 'artist-credits', fmt: 'json' })
    let data: MBRecordingLookup
    try {
      data = await request<MBRecordingLookup>(`/recording/${mbid}?${params}`)
    } catch (err) {
      if (err instanceof Error && err.message.includes('404')) return null
      throw err
    }
    const credit = data['artist-credit']?.[0]
    if (!credit) return null
    return {
      recordingMbid: mbid,
      artistMbid: credit.artist.id,
      artistName: credit.artist.name,
    }
  }

  function extractStreamingUrls(relations: MBRelation[]): StreamingUrls {
    const result: StreamingUrls = {}

    for (const rel of relations) {
      if (!rel.url?.resource) continue
      if (!STREAMING_TYPES.has(rel.type)) continue

      const resource = rel.url.resource

      for (const [pattern, key] of STREAMING_PATTERNS) {
        if (pattern.test(resource) && result[key] === undefined) {
          result[key] = resource
          break
        }
      }
    }

    return result
  }

  return {
    lookupArtist,
    searchArtist,
    getReleaseGroups,
    getRecordings,
    lookupRecording,
    extractStreamingUrls,
  }
}
