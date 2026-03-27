import PQueue from 'p-queue'
import { VERSION } from '@/version'

const BASE_URL = 'https://musicbrainz.org/ws/2'
const USER_AGENT = `Digarr/${VERSION} (https://github.com/iuliandita/digarr)`

export type MBArtist = {
  id: string
  name: string
  disambiguation?: string
  tags?: Array<{ name: string; count: number }>
  relations?: MBRelation[]
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

export function createMusicBrainzClient() {
  const queue = new PQueue({ concurrency: 1, interval: 1000, intervalCap: 1 })

  async function request<T>(path: string): Promise<T> {
    return queue.add(async () => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 10_000)

      try {
        const res = await fetch(`${BASE_URL}${path}`, {
          headers: { 'User-Agent': USER_AGENT },
          signal: controller.signal,
        })

        if (!res.ok) {
          throw new Error(`MusicBrainz HTTP ${res.status} for ${path}`)
        }

        return res.json() as Promise<T>
      } finally {
        clearTimeout(timer)
      }
    }) as Promise<T>
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
    extractStreamingUrls,
  }
}
