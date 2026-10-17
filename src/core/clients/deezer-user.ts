import { errMsg, redactSecrets } from '@/core/validation'
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
  next?: string
}

type DeezerPlaylistsResponse = {
  data: Array<{ id: number; title: string; nb_tracks: number; picture_medium?: string }>
  next?: string
}

type DeezerTracksResponse = {
  data: Array<{ id: number; title: string; artist?: { id: number; name: string } | null }>
  next?: string
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

  async function request<T>(path: string): Promise<T> {
    let res: T & { error?: unknown }
    try {
      res = await http.get<T & { error?: unknown }>(path)
    } catch (error) {
      let message = errMsg(error)
      if (accessToken) {
        message = message
          .replaceAll(encodeURIComponent(accessToken), '[REDACTED]')
          .replaceAll(accessToken, '[REDACTED]')
      }
      throw new Error(
        `Deezer request failed: ${redactSecrets(message)}. Check your Deezer connection in Settings and reconnect if needed.`,
      )
    }
    if (res && typeof res === 'object' && res.error != null) {
      throw new Error(
        'Deezer request failed. Reconnect Deezer or check its configuration in Settings.',
      )
    }
    return res
  }

  const MAX_PAGES = 20

  // Follows Deezer's `next` marker by advancing `index`; capped so a looping API cannot spin.
  async function paginate<T>(path: string, pageSize: number, max = Infinity): Promise<T[]> {
    const items: T[] = []
    let index = 0
    for (let page = 0; page < MAX_PAGES && items.length < max; page++) {
      const res = await request<{ data?: T[]; next?: string }>(
        `${path}&limit=${pageSize}&index=${index}`,
      )
      const batch = res.data ?? []
      items.push(...batch)
      if (!res.next || batch.length === 0) break
      index += batch.length
    }
    return items.slice(0, max)
  }

  async function getFavoriteArtists(limit = 100): Promise<DeezerUserArtist[]> {
    const data = await paginate<DeezerArtistResponse['data'][number]>(
      `/user/me/artists?${authParam()}`,
      Math.min(limit, 100),
      limit,
    )
    return data.map((a) => ({ id: a.id, name: a.name, fans: a.nb_fan }))
  }

  // Deezer treats favorites and followed as the same concept - both hit /user/me/artists.
  // Kept as a separate method for adapter flexibility (different scores/labels).
  async function getFollowedArtists(limit = 100): Promise<DeezerUserArtist[]> {
    return getFavoriteArtists(limit)
  }

  async function getFlowRecommendations(limit = 50): Promise<DeezerUserArtist[]> {
    const res = await request<DeezerArtistResponse>(
      `/user/me/recommendations/artists?${authParam()}&limit=${limit}`,
    )
    return (res.data ?? []).map((a) => ({ id: a.id, name: a.name, fans: a.nb_fan }))
  }

  async function getPlaylists(): Promise<DeezerPlaylistSummary[]> {
    const data = await paginate<DeezerPlaylistsResponse['data'][number]>(
      `/user/me/playlists?${authParam()}`,
      100,
    )
    return data.map((p) => ({
      id: p.id,
      title: p.title,
      trackCount: p.nb_tracks,
      imageUrl: p.picture_medium ?? undefined,
    }))
  }

  async function getPlaylistTracks(playlistId: number): Promise<string[]> {
    const data = await paginate<DeezerTracksResponse['data'][number]>(
      `/playlist/${playlistId}/tracks?${authParam()}`,
      500,
    )
    const seen = new Set<string>()
    const names: string[] = []
    for (const track of data) {
      const name = track.artist?.name
      if (!name) continue
      const key = name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      names.push(name)
    }
    return names
  }

  async function getMe(): Promise<DeezerMeResponse> {
    return request<DeezerMeResponse>(`/user/me?${authParam()}`)
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
