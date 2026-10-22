import { createHttpClient } from '@/core/clients/http'
import { sleep as defaultSleep } from '@/core/sleep'
import type { ServiceTestResult } from '@/core/types'
import { errMsg } from '@/core/validation'
import type { TopTrack } from '@/db/schema'

const DEFAULT_BASE_URL = 'https://api.deezer.com'
const QUOTA_ERROR_CODE = 4
const QUOTA_BACKOFF_MS = 1500

export type DeezerSearchResult = {
  id: number
  name: string
  fans: number
  imageUrl?: string
  url: string
}

// Raw Deezer API response shapes
type DeezerArtistItem = {
  id: number
  name: string
  nb_fan: number
  picture_medium?: string
  link: string
}

type DeezerSearchResponse = {
  data: DeezerArtistItem[]
  total?: number
  error?: { type: string; message: string; code: number }
}

type DeezerTrackItem = {
  id?: number
  title: string
  preview: string
  duration: number // seconds
  rank?: number
  artist?: { name?: string }
}

type DeezerTopTracksResponse = {
  data: DeezerTrackItem[]
  error?: { type: string; message: string; code: number }
}

type DeezerTrackSearchResponse = {
  data: DeezerTrackItem[]
  total?: number
  error?: { type: string; message: string; code: number }
}

export function createDeezerClient(config?: {
  baseUrl?: string
  sleep?: (ms: number) => Promise<void>
}) {
  const baseUrl = config?.baseUrl ?? DEFAULT_BASE_URL
  const sleep = config?.sleep ?? defaultSleep
  const http = createHttpClient({ baseUrl })

  // Deezer reports errors (including quota) as HTTP 200 with an error object. A quota
  // error during a request burst usually clears within a second, so retry once.
  async function getChecked<T extends { error?: { message: string; code: number } }>(
    path: string,
  ): Promise<T> {
    let res = await http.get<T>(path)
    if (res.error?.code === QUOTA_ERROR_CODE) {
      await sleep(QUOTA_BACKOFF_MS)
      res = await http.get<T>(path)
    }
    if (res.error) {
      throw new Error(`Deezer API error: ${res.error.message}`)
    }
    return res
  }

  async function searchArtists(query: string, limit = 25): Promise<DeezerSearchResult[]> {
    const params = new URLSearchParams({ q: query, limit: String(limit) })
    const res = await getChecked<DeezerSearchResponse>(`/search/artist?${params.toString()}`)
    return (res.data ?? []).map((item) => ({
      id: item.id,
      name: item.name,
      fans: item.nb_fan,
      imageUrl: item.picture_medium || undefined,
      url: item.link,
    }))
  }

  async function fetchTopTrackItems(artistId: number, limit: number): Promise<DeezerTrackItem[]> {
    const params = new URLSearchParams({ limit: String(limit) })
    const res = await getChecked<DeezerTopTracksResponse>(
      `/artist/${artistId}/top?${params.toString()}`,
    )
    return res.data ?? []
  }

  async function getArtistTopTracks(artistId: number, limit = 5): Promise<TopTrack[]> {
    return (await fetchTopTrackItems(artistId, limit)).map((track) => ({
      name: track.title,
      previewUrl: track.preview || undefined,
      durationMs: track.duration * 1000,
    }))
  }

  // Ids for playlist resolution; preview URLs are signed and expire, so they are dropped.
  async function getArtistTopTrackResults(
    artistId: number,
    limit = 5,
  ): Promise<Array<{ id: string; name: string; artists: string[]; rank: number }>> {
    return (await fetchTopTrackItems(artistId, limit)).flatMap((item) =>
      item.id && item.title
        ? [
            {
              id: String(item.id),
              name: item.title,
              artists: item.artist?.name ? [item.artist.name] : [],
              rank: item.rank ?? 0,
            },
          ]
        : [],
    )
  }

  async function searchTracks(
    query: string,
    limit = 25,
  ): Promise<Array<{ id: string; name: string; artists: string[]; rank: number }>> {
    const params = new URLSearchParams({ q: query, limit: String(limit) })
    const res = await getChecked<DeezerTrackSearchResponse>(`/search/track?${params.toString()}`)
    return (res.data ?? []).flatMap((item) =>
      item.id && item.title
        ? [
            {
              id: String(item.id),
              name: item.title,
              artists: item.artist?.name ? [item.artist.name] : [],
              rank: item.rank ?? 0,
            },
          ]
        : [],
    )
  }

  async function testConnection(): Promise<ServiceTestResult> {
    try {
      const results = await searchArtists('test', 1)
      return {
        success: true,
        message: `Connected to Deezer - API responding`,
        details: { resultCount: results.length },
      }
    } catch (err: unknown) {
      return { success: false, message: errMsg(err) }
    }
  }

  return {
    searchArtists,
    searchTracks,
    getArtistTopTracks,
    getArtistTopTrackResults,
    testConnection,
  }
}
