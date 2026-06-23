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

export type SpotifyPopularAlbum = {
  id: string
  title: string
  releaseDate?: string
  popularity: number
  spotifyUrl?: string
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

type SpotifySearchArtistsResponse = {
  artists: {
    items: Array<{
      name: string
      id: string
      genres: string[]
      popularity: number
    }>
  }
}

type SpotifyArtistAlbumsResponse = {
  items: Array<{
    id: string
    name: string
    release_date?: string
    album_type?: string
  }>
  next: string | null
}

type SpotifyAlbumsResponse = {
  albums: Array<{
    id: string
    name: string
    release_date?: string
    popularity?: number
    external_urls?: { spotify?: string }
  } | null>
}

type SpotifySavedAlbumsResponse = {
  items: Array<{
    album: {
      artists: Array<{ name: string }>
    } | null
  }>
  next: string | null
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

  async function findExactArtistByName(name: string): Promise<SpotifyTopArtist | null> {
    const params = new URLSearchParams({
      q: name,
      type: 'artist',
      limit: '10',
    })
    const res = await get<SpotifySearchArtistsResponse>(`/search?${params}`)
    const exactMatches = res.artists.items.filter(
      (artist) => artist.name.toLowerCase() === name.toLowerCase(),
    )
    if (exactMatches.length !== 1 || !exactMatches[0]) return null
    return {
      name: exactMatches[0].name,
      id: exactMatches[0].id,
      genres: exactMatches[0].genres,
      popularity: exactMatches[0].popularity,
    }
  }

  async function getPopularAlbumsForArtist(
    artistId: string,
    limit = 3,
  ): Promise<SpotifyPopularAlbum[]> {
    const albumIds: string[] = []
    const seen = new Set<string>()
    const pageSize = 10

    for (let offset = 0; albumIds.length < 50; offset += pageSize) {
      const params = new URLSearchParams({
        include_groups: 'album',
        limit: String(pageSize),
        offset: String(offset),
      })
      const res = await get<SpotifyArtistAlbumsResponse>(
        `/artists/${encodeURIComponent(artistId)}/albums?${params}`,
      )
      for (const album of res.items) {
        if (!album.id || seen.has(album.id)) continue
        seen.add(album.id)
        albumIds.push(album.id)
      }
      if (!res.next || res.items.length < pageSize) break
    }

    const albums: SpotifyPopularAlbum[] = []
    for (let offset = 0; offset < albumIds.length; offset += 20) {
      const ids = albumIds.slice(offset, offset + 20)
      const params = new URLSearchParams({ ids: ids.join(',') })
      const res = await get<SpotifyAlbumsResponse>(`/albums?${params}`)
      for (const album of res.albums) {
        if (!album) continue
        albums.push({
          id: album.id,
          title: album.name,
          releaseDate: album.release_date,
          popularity: album.popularity ?? 0,
          spotifyUrl: album.external_urls?.spotify,
        })
      }
    }

    return albums.sort((a, b) => b.popularity - a.popularity).slice(0, limit)
  }

  async function getSavedAlbums(limit = 100): Promise<Array<{ name: string }>> {
    const pageSize = 50
    const names: Array<{ name: string }> = []
    const seen = new Set<string>()

    for (let offset = 0; names.length < limit; offset += pageSize) {
      const params = new URLSearchParams({
        limit: String(pageSize),
        offset: String(offset),
      })
      const res = await get<SpotifySavedAlbumsResponse>(`/me/albums?${params}`)
      const items = res.items ?? []
      for (const item of items) {
        for (const artist of item.album?.artists ?? []) {
          const name = artist.name?.trim()
          if (!name) continue
          const key = name.toLowerCase()
          if (seen.has(key)) continue
          seen.add(key)
          names.push({ name })
          if (names.length >= limit) break
        }
        if (names.length >= limit) break
      }
      if (!res.next || items.length === 0) break
    }

    return names.slice(0, limit)
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
    findExactArtistByName,
    getPopularAlbumsForArtist,
    getSavedAlbums,
    testConnection,
  }
}
