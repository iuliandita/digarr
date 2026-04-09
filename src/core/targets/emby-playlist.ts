import type { ServiceTestResult } from '@/core/types'
import { errMsg } from '@/core/validation'
import type { DestinationTarget, PlaylistItem, PlaylistResult } from './types'

export type EmbyPlaylistConfig = {
  url: string
  apiKey: string
  userId: string
}

async function embyFetch<T>(
  baseUrl: string,
  apiKey: string,
  path: string,
  options?: { method?: string; body?: unknown },
): Promise<T> {
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}${path}`, {
    method: options?.method ?? 'GET',
    headers: {
      'X-Emby-Token': apiKey,
      'Content-Type': 'application/json',
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  })
  if (!res.ok) {
    throw new Error(`Emby API ${res.status}: ${await res.text()}`)
  }
  return res.json() as Promise<T>
}

export function createEmbyPlaylistTarget(
  targetId: number,
  config: EmbyPlaylistConfig,
): DestinationTarget {
  return {
    id: `emby-playlist-${targetId}`,
    name: 'Emby Playlist',
    type: 'emby-playlist',
    capabilities: ['createPlaylist'],

    async createPlaylist(name: string, items: PlaylistItem[]): Promise<PlaylistResult> {
      try {
        const itemIds: string[] = []
        for (const item of items) {
          if (!item.trackName) continue
          const params = new URLSearchParams({
            searchTerm: `${item.artistName} ${item.trackName}`,
            IncludeItemTypes: 'Audio',
            Recursive: 'true',
            Limit: '5',
            Fields: 'Name,AlbumArtist,Artists',
          })
          const search = await embyFetch<{
            Items: Array<{ Id: string; Name: string; AlbumArtist?: string; Artists?: string[] }>
          }>(config.url, config.apiKey, `/Users/${config.userId}/Items?${params.toString()}`)
          const match = search.Items?.[0]
          if (match?.Id) itemIds.push(match.Id)
        }

        const playlist = await embyFetch<{ Id: string }>(config.url, config.apiKey, '/Playlists', {
          method: 'POST',
          body: {
            Name: name,
            UserId: config.userId,
            MediaType: 'Audio',
            Ids: itemIds,
          },
        })

        return {
          success: true,
          targetType: 'emby-playlist',
          targetId,
          playlistId: playlist.Id,
          playlistName: name,
          itemsAdded: itemIds.length,
        }
      } catch (err) {
        return {
          success: false,
          targetType: 'emby-playlist',
          targetId,
          error: errMsg(err),
        }
      }
    },

    async testConnection(): Promise<ServiceTestResult> {
      try {
        const info = await embyFetch<{ ServerName: string; Version: string }>(
          config.url,
          config.apiKey,
          '/System/Info',
        )
        return {
          success: true,
          message: `Connected to Emby "${info.ServerName}" v${info.Version}`,
        }
      } catch (err) {
        return { success: false, message: errMsg(err) }
      }
    },
  }
}
