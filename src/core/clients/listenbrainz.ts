import type { ListeningActivityEntry } from '@/core/plugins/types'
import type { ServiceTestResult } from '@/core/types'
import { errMsg } from '@/core/validation'
import { createHttpClient } from './http'

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

type LbRadioRecording = {
  recording_mbid: string
  similar_artist_mbid: string
  similar_artist_name: string
  total_listen_count: number
}

type LbRadioResponse = Record<string, LbRadioRecording[]>

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
    const params = new URLSearchParams({
      mode: 'easy',
      max_similar_artists: '25',
      max_recordings_per_artist: '1',
      pop_begin: '0',
      pop_end: '100',
    })
    const res = await http.get<LbRadioResponse>(`/1/lb-radio/artist/${mbid}?${params.toString()}`)
    // Each key is an artist MBID containing recordings from that similar artist.
    // Deduplicate by MBID and filter out the seed artist.
    const seen = new Set<string>()
    const artists: SimilarArtist[] = []
    for (const recordings of Object.values(res)) {
      for (const rec of recordings) {
        if (rec.similar_artist_mbid === mbid) continue
        if (seen.has(rec.similar_artist_mbid)) continue
        seen.add(rec.similar_artist_mbid)
        artists.push({ name: rec.similar_artist_name, score: 0.7 })
      }
    }
    return artists
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
