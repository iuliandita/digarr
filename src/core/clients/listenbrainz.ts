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

export type RadioMode = 'easy' | 'medium' | 'hard'

export type RadioArtist = {
  name: string
  mbid: string
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

type LbSimilarUser = {
  user_name: string
  similarity: number
}

type LbSimilarUsersResponse = {
  payload: LbSimilarUser[]
}

export type SimilarUser = {
  username: string
  similarity: number
}

export type TagRadioInput = {
  tag: string
  weight: number
}

export type TagRadioRecording = {
  recordingMbid: string
  percent: number
  source: string
  tagCount: number
}

// Raw LB tag radio response shape
type LbTagRadioRecording = {
  recording_mbid: string
  percent: number
  source: string
  tag_count: number
}

function buildTagExpression(tags: TagRadioInput[]): string {
  if (tags.length === 1) return tags[0]?.tag ?? ''
  return tags.map((t) => `(${t.tag}):${t.weight}`).join(':')
}

function extractRadioArtists(res: LbRadioResponse, excludeMbid?: string): RadioArtist[] {
  const seen = new Set<string>()
  const artists: RadioArtist[] = []
  let position = 0
  for (const recordings of Object.values(res)) {
    for (const rec of recordings) {
      if (excludeMbid && rec.similar_artist_mbid === excludeMbid) continue
      if (seen.has(rec.similar_artist_mbid)) continue
      seen.add(rec.similar_artist_mbid)
      position++
      artists.push({
        name: rec.similar_artist_name,
        mbid: rec.similar_artist_mbid,
        // Position-based decay: ~0.97 for first result, floors at 0.3 (reached at position 24)
        score: Math.max(0.3, 1 - position * 0.03),
      })
    }
  }
  return artists
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

  async function getArtistRadio(mbid: string, mode: RadioMode = 'medium'): Promise<RadioArtist[]> {
    const params = new URLSearchParams({
      mode,
      max_similar_artists: '25',
      max_recordings_per_artist: '2',
      pop_begin: '0',
      pop_end: '100',
    })
    const res = await http.get<LbRadioResponse>(`/1/lb-radio/artist/${mbid}?${params.toString()}`)
    return extractRadioArtists(res, mbid)
  }

  // No direct user radio endpoint exists in the LB API. Instead, get the
  // user's top artist and run artist radio seeded from it.
  async function getUserRadio(
    targetUsername: string,
    mode: RadioMode = 'medium',
  ): Promise<RadioArtist[]> {
    const topArtists = await getTopArtistsForUser(targetUsername, 'month')
    const seed = topArtists.find((a) => a.mbid)
    if (!seed?.mbid) return []
    return getArtistRadio(seed.mbid, mode)
  }

  async function getSimilarUsers(): Promise<SimilarUser[]> {
    const res = await http.get<LbSimilarUsersResponse>(`/1/user/${username}/similar-users`)
    return (res.payload ?? []).map((u) => ({
      username: u.user_name,
      similarity: u.similarity,
    }))
  }

  async function getTopArtistsForUser(
    targetUsername: string,
    range: ListenBrainzRange,
  ): Promise<TopArtist[]> {
    const res = await http.get<LbTopArtistsResponse>(
      `/1/stats/user/${targetUsername}/artists?range=${range}`,
    )
    return res.payload.artists.map((a) => ({
      name: a.artist_name,
      mbid: a.artist_mbid || undefined,
      playCount: a.listen_count,
      source: 'listenbrainz' as const,
    }))
  }

  async function getTagRadio(
    tags: TagRadioInput[],
    options?: { count?: number; popBegin?: number; popEnd?: number },
  ): Promise<TagRadioRecording[]> {
    const params = new URLSearchParams({
      tag: buildTagExpression(tags),
      count: String(options?.count ?? 25),
      pop_begin: String(options?.popBegin ?? 0),
      pop_end: String(options?.popEnd ?? 100),
    })
    const res = await http.get<LbTagRadioRecording[]>(`/1/lb-radio/tags?${params.toString()}`)
    return (res ?? []).map((r) => ({
      recordingMbid: r.recording_mbid,
      percent: r.percent,
      source: r.source,
      tagCount: r.tag_count,
    }))
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
    getArtistRadio,
    getUserRadio,
    getSimilarUsers,
    getTopArtistsForUser,
    getTagRadio,
    testConnection,
  }
}
