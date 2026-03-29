import { createHttpClient } from '@/core/clients/http'
import type { ServiceTestResult } from '@/core/types'
import { errMsg } from '@/core/validation'
import type { TopTrack } from '@/db/schema'

const DEFAULT_BASE_URL = 'https://api.deezer.com'

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
  title: string
  preview: string
  duration: number // seconds
}

type DeezerTopTracksResponse = {
  data: DeezerTrackItem[]
  error?: { type: string; message: string; code: number }
}

export function createDeezerClient(config?: { baseUrl?: string }) {
  const baseUrl = config?.baseUrl ?? DEFAULT_BASE_URL
  const http = createHttpClient({ baseUrl })

  async function searchArtists(query: string, limit = 25): Promise<DeezerSearchResult[]> {
    const params = new URLSearchParams({ q: query, limit: String(limit) })
    const res = await http.get<DeezerSearchResponse>(`/search/artist?${params.toString()}`)
    if (res.error) {
      throw new Error(`Deezer API error: ${res.error.message}`)
    }
    return (res.data ?? []).map((item) => ({
      id: item.id,
      name: item.name,
      fans: item.nb_fan,
      imageUrl: item.picture_medium || undefined,
      url: item.link,
    }))
  }

  async function getArtistTopTracks(artistId: number, limit = 5): Promise<TopTrack[]> {
    try {
      const params = new URLSearchParams({ limit: String(limit) })
      const res = await http.get<DeezerTopTracksResponse>(
        `/artist/${artistId}/top?${params.toString()}`,
      )
      if (res.error || !res.data) return []
      return res.data.map((track) => ({
        name: track.title,
        previewUrl: track.preview || undefined,
        durationMs: track.duration * 1000,
      }))
    } catch {
      return []
    }
  }

  async function testConnection(): Promise<ServiceTestResult> {
    try {
      const results = await searchArtists('test', 1)
      return {
        success: true,
        message: `Connected to Deezer -- API responding`,
        details: { resultCount: results.length },
      }
    } catch (err: unknown) {
      return { success: false, message: errMsg(err) }
    }
  }

  return {
    searchArtists,
    getArtistTopTracks,
    testConnection,
  }
}
