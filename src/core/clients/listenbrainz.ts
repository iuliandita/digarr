import type { ListeningActivityEntry } from '@/core/plugins/types'
import type { ServiceTestResult } from '@/core/types'
import { errMsg } from '@/core/validation'
import { createHttpClient, HttpError } from './http'

const BASE_URL = 'https://api.listenbrainz.org'

export type ListenBrainzRange = 'week' | 'month' | 'year' | 'all_time'

export type TopArtist = {
  name: string
  mbid?: string
  playCount: number
  source: 'listenbrainz'
}

export type SimilarArtist = {
  name: string
  score: number
}

// Raw LB response shapes
type LbTopArtistsResponse = {
  payload: {
    artists: Array<{
      artist_name: string
      artist_mbid: string
      listen_count: number
    }>
  }
}

type LbListenCountResponse = {
  payload: { count: number }
}

type LbListeningActivityResponse = {
  payload: {
    listening_activity: ListeningActivityEntry[]
  }
}

type LbSimilarArtistEntry = {
  name: string
  artist_mbid?: string
  score: number
}

export function createListenBrainzClient(username: string, token: string) {
  const http = createHttpClient({
    baseUrl: BASE_URL,
    headers: { Authorization: `Token ${token}` },
  })

  async function getTopArtists(range: ListenBrainzRange): Promise<TopArtist[]> {
    const res = await http.get<LbTopArtistsResponse>(
      `/1/stats/user/${username}/artists?range=${range}`,
    )
    return res.payload.artists.map((a) => ({
      name: a.artist_name,
      mbid: a.artist_mbid || undefined,
      playCount: a.listen_count,
      source: 'listenbrainz' as const,
    }))
  }

  async function getListenCount(): Promise<number> {
    const res = await http.get<LbListenCountResponse>(`/1/user/${username}/listen-count`)
    return res.payload.count
  }

  async function getListeningActivity(): Promise<ListeningActivityEntry[]> {
    const res = await http.get<LbListeningActivityResponse>(
      `/1/stats/user/${username}/listening-activity?range=month`,
    )
    return res.payload.listening_activity
  }

  async function getSimilarArtists(mbid: string): Promise<SimilarArtist[]> {
    try {
      const res = await http.get<LbSimilarArtistEntry[]>(`/1/artist/${mbid}/similar`)
      return res.map((a) => ({ name: a.name, score: a.score }))
    } catch (err: unknown) {
      if (err instanceof HttpError && err.status === 404) {
        throw new Error('ListenBrainz similar artists endpoint unavailable (404)')
      }
      throw err
    }
  }

  async function testConnection(): Promise<ServiceTestResult> {
    try {
      const count = await getListenCount()
      return {
        success: true,
        message: `Connected to ListenBrainz -- ${count} listens for ${username}`,
        details: { listenCount: count },
      }
    } catch (err: unknown) {
      return { success: false, message: errMsg(err) }
    }
  }

  return {
    getTopArtists,
    getListenCount,
    getListeningActivity,
    getSimilarArtists,
    testConnection,
  }
}
