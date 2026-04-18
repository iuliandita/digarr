import type { ServiceTestResult } from '@/core/types'
import { errMsg } from '@/core/validation'
import { pickBestTrackMatch } from './playlist-match'
import type { DestinationTarget, PlaylistItem, PlaylistResult } from './types'

export type JellyfinPlaylistConfig = {
  url: string
  apiKey: string
  userId: string
  skipTlsVerify?: boolean
}

async function jellyfinFetch<T>(
  baseUrl: string,
  apiKey: string,
  path: string,
  options?: { method?: string; body?: unknown; skipTlsVerify?: boolean },
): Promise<T> {
  const url = `${baseUrl.replace(/\/+$/, '')}${path}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  let res: Response
  try {
    res = await fetch(url, {
      method: options?.method ?? 'GET',
      headers: {
        'X-Emby-Token': apiKey,
        'Content-Type': 'application/json',
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
      ...(options?.skipTlsVerify ? { tls: { rejectUnauthorized: false } } : {}),
    })
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Jellyfin API ${res.status}: ${text}`)
  }
  return (await res.json()) as T
}

export function createJellyfinPlaylistTarget(
  targetId: number,
  config: JellyfinPlaylistConfig,
): DestinationTarget {
  const { url, apiKey, userId } = config

  async function searchTrack(artistName: string, trackName: string): Promise<string | null> {
    try {
      const params = new URLSearchParams({
        searchTerm: `${artistName} ${trackName}`,
        IncludeItemTypes: 'Audio',
        Recursive: 'true',
        Limit: '5',
        Fields: 'Name,AlbumArtist,Artists',
      })
      const res = await jellyfinFetch<{
        Items: Array<{ Id: string; Name: string; AlbumArtist?: string; Artists?: string[] }>
      }>(url, apiKey, `/Users/${userId}/Items?${params.toString()}`)

      return pickBestTrackMatch(
        (res.Items ?? []).map((item) => ({
          id: item.Id,
          title: item.Name,
          artists: [item.AlbumArtist, ...(item.Artists ?? [])].filter((artist): artist is string =>
            Boolean(artist),
          ),
        })),
        artistName,
        trackName,
      )
    } catch (err) {
      console.warn('[jellyfin-playlist] searchTrack transport error:', {
        artistName,
        trackName,
        error: err instanceof Error ? err.message : String(err),
      })
      return null
    }
  }

  return {
    id: `jellyfin-playlist-${targetId}`,
    name: 'Jellyfin Playlist',
    type: 'jellyfin-playlist',
    capabilities: ['createPlaylist'],

    async createPlaylist(
      name: string,
      items: PlaylistItem[],
      _options?: { description?: string; public?: boolean; replace?: boolean },
    ): Promise<PlaylistResult> {
      try {
        // Resolve Jellyfin item IDs for items that have a trackName
        const itemIds: string[] = []
        for (const item of items) {
          if (!item.trackName) continue
          const id = await searchTrack(item.artistName, item.trackName)
          if (id) itemIds.push(id)
        }

        // Create the playlist
        const playlist = await jellyfinFetch<{ Id: string; Name: string }>(
          url,
          apiKey,
          '/Playlists',
          {
            method: 'POST',
            body: {
              Name: name,
              UserId: userId,
              MediaType: 'Audio',
              Ids: itemIds,
            },
            skipTlsVerify: config.skipTlsVerify,
          },
        )

        const playlistId = playlist.Id
        if (!playlistId) {
          throw new Error('Jellyfin did not return a playlist ID')
        }

        return {
          success: true,
          targetType: 'jellyfin-playlist',
          targetId,
          playlistId,
          playlistName: name,
          itemsAdded: itemIds.length,
        }
      } catch (err: unknown) {
        return {
          success: false,
          targetType: 'jellyfin-playlist',
          targetId,
          error: errMsg(err),
        }
      }
    },

    async testConnection(): Promise<ServiceTestResult> {
      try {
        const info = await jellyfinFetch<{ ServerName: string; Version: string }>(
          url,
          apiKey,
          '/System/Info',
          { skipTlsVerify: config.skipTlsVerify },
        )
        return {
          success: true,
          message: `Connected to Jellyfin "${info.ServerName}" v${info.Version}`,
          details: { serverName: info.ServerName, version: info.Version },
        }
      } catch (err: unknown) {
        return {
          success: false,
          message: errMsg(err),
        }
      }
    },
  }
}
