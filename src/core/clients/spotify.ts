import PQueue from 'p-queue'
import type { ServiceTestResult } from '@/core/types'
import { errMsg } from '@/core/validation'
import { createHttpClient } from './http'

const BASE_URL = 'https://api.spotify.com/v1'

export type SpotifyTimeRange = 'short_term' | 'medium_term' | 'long_term'

export type SpotifyTopArtist = {
  name: string
  id: string
  genres: string[]
  popularity: number
}

export type SpotifyRecentTrack = {
  name: string
  artists: Array<{ name: string; id: string }>
  playedAt: string
}

export type SpotifySearchTrack = {
  name: string
  artists: string[]
  uri: string
  popularity: number
}

// Raw Spotify API response shapes
type SpotifyTopArtistsResponse = {
  items: Array<{
    name: string
    id: string
    genres: string[]
    popularity: number
  }>
}

type SpotifyRecentlyPlayedResponse = {
  items: Array<{
    track: {
      name: string
      artists: Array<{ name: string; id: string }>
    }
    played_at: string
  }>
}

type SpotifyProfileResponse = {
  display_name: string
  id: string
}

type SpotifySearchTracksResponse = {
  tracks: {
    items: Array<{
      name: string
      uri: string
      popularity: number
      artists: Array<{ name: string }>
    }>
  }
}

export function createSpotifyClient(accessToken: string, options?: { baseUrl?: string }) {
  const http = createHttpClient({
    baseUrl: options?.baseUrl ?? BASE_URL,
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  const queue = new PQueue({ concurrency: 10, interval: 1000, intervalCap: 25 })

  function get<T>(path: string): Promise<T> {
    return queue.add(() => http.get<T>(path)) as Promise<T>
  }

  async function getTopArtists(
    timeRange: SpotifyTimeRange = 'medium_term',
    limit = 50,
  ): Promise<SpotifyTopArtist[]> {
    const params = new URLSearchParams({
      time_range: timeRange,
      limit: String(limit),
    })
    const res = await get<SpotifyTopArtistsResponse>(`/me/top/artists?${params}`)
    return res.items.map((a) => ({
      name: a.name,
      id: a.id,
      genres: a.genres,
      popularity: a.popularity,
    }))
  }

  async function getRecentlyPlayed(limit = 50): Promise<SpotifyRecentTrack[]> {
    const params = new URLSearchParams({ limit: String(limit) })
    const res = await get<SpotifyRecentlyPlayedResponse>(`/me/player/recently-played?${params}`)
    return res.items.map((item) => ({
      name: item.track.name,
      artists: item.track.artists.map((a) => ({ name: a.name, id: a.id })),
      playedAt: item.played_at,
    }))
  }

  async function searchTracks(query: string, limit = 10): Promise<SpotifySearchTrack[]> {
    const params = new URLSearchParams({
      q: query,
      type: 'track',
      limit: String(limit),
    })
    const res = await get<SpotifySearchTracksResponse>(`/search?${params}`)
    return res.tracks.items.map((item) => ({
      name: item.name,
      artists: item.artists.map((artist) => artist.name),
      uri: item.uri,
      popularity: item.popularity,
    }))
  }

  async function testConnection(): Promise<ServiceTestResult> {
    try {
      const profile = await get<SpotifyProfileResponse>('/me')
      return {
        success: true,
        message: `Connected to Spotify as ${profile.display_name}`,
        details: { userId: profile.id },
      }
    } catch (err: unknown) {
      return { success: false, message: errMsg(err) }
    }
  }

  return {
    getTopArtists,
    getRecentlyPlayed,
    searchTracks,
    testConnection,
  }
}
