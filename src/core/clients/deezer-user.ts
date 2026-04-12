import { createHttpClient } from './http'

const BASE_URL = 'https://api.deezer.com'

export type DeezerUserArtist = {
  id: number
  name: string
  fans: number
}

export type DeezerPlaylistSummary = {
  id: number
  title: string
  trackCount: number
  imageUrl?: string
}

type DeezerArtistResponse = {
  data: Array<{ id: number; name: string; nb_fan: number; link: string }>
  total?: number
}

type DeezerPlaylistsResponse = {
  data: Array<{ id: number; title: string; nb_tracks: number; picture_medium?: string }>
}

type DeezerTracksResponse = {
  data: Array<{ id: number; title: string; artist: { id: number; name: string } }>
}

type DeezerMeResponse = {
  id: number
  name: string
}

export function createDeezerUserClient(accessToken: string) {
  const http = createHttpClient({
    baseUrl: BASE_URL,
  })

  function authParam(): string {
    return `access_token=${encodeURIComponent(accessToken)}`
  }

  async function getFavoriteArtists(limit = 100): Promise<DeezerUserArtist[]> {
    const res = await http.get<DeezerArtistResponse>(
      `/user/me/artists?${authParam()}&limit=${limit}`,
    )
    return (res.data ?? []).map((a) => ({ id: a.id, name: a.name, fans: a.nb_fan }))
  }

  // Deezer treats favorites and followed as the same concept - both hit /user/me/artists.
  // Kept as a separate method for adapter flexibility (different scores/labels).
  async function getFollowedArtists(limit = 100): Promise<DeezerUserArtist[]> {
    const res = await http.get<DeezerArtistResponse>(
      `/user/me/artists?${authParam()}&limit=${limit}`,
    )
    return (res.data ?? []).map((a) => ({ id: a.id, name: a.name, fans: a.nb_fan }))
  }

  async function getFlowRecommendations(limit = 50): Promise<DeezerUserArtist[]> {
    const res = await http.get<DeezerArtistResponse>(
      `/user/me/recommendations/artists?${authParam()}&limit=${limit}`,
    )
    return (res.data ?? []).map((a) => ({ id: a.id, name: a.name, fans: a.nb_fan }))
  }

  async function getPlaylists(): Promise<DeezerPlaylistSummary[]> {
    const res = await http.get<DeezerPlaylistsResponse>(`/user/me/playlists?${authParam()}`)
    return (res.data ?? []).map((p) => ({
      id: p.id,
      title: p.title,
      trackCount: p.nb_tracks,
      imageUrl: p.picture_medium ?? undefined,
    }))
  }

  async function getPlaylistTracks(playlistId: number): Promise<string[]> {
    const res = await http.get<DeezerTracksResponse>(
      `/playlist/${playlistId}/tracks?${authParam()}&limit=500`,
    )
    const seen = new Set<string>()
    const names: string[] = []
    for (const track of res.data ?? []) {
      const name = track.artist.name
      const key = name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      names.push(name)
    }
    return names
  }

  async function getMe(): Promise<DeezerMeResponse> {
    return http.get<DeezerMeResponse>(`/user/me?${authParam()}`)
  }

  return {
    getFavoriteArtists,
    getFollowedArtists,
    getFlowRecommendations,
    getPlaylists,
    getPlaylistTracks,
    getMe,
  }
}
