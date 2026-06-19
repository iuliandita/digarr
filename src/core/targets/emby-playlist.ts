import type { ServiceTestResult } from '@/core/types'
import { errMsg } from '@/core/validation'
import { pickBestTrackMatch } from './playlist-match'
import type { DestinationTarget, PlaylistItem, PlaylistResult } from './types'

export type EmbyPlaylistConfig = {
  url: string
  apiKey: string
  userId: string
  skipTlsVerify?: boolean
}

async function embyFetch<T>(
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
          }>(config.url, config.apiKey, `/Users/${config.userId}/Items?${params.toString()}`, {
            skipTlsVerify: config.skipTlsVerify,
          })
          const matchId = pickBestTrackMatch(
            (search.Items ?? []).map((result) => ({
              id: result.Id,
              title: result.Name,
              artists: [result.AlbumArtist, ...(result.Artists ?? [])].filter(
                (artist): artist is string => Boolean(artist),
              ),
            })),
            item.artistName,
            item.trackName,
          )
          if (matchId) itemIds.push(matchId)
        }

        const playlist = await embyFetch<{ Id: string }>(config.url, config.apiKey, '/Playlists', {
          method: 'POST',
          body: {
            Name: name,
            UserId: config.userId,
            MediaType: 'Audio',
            Ids: itemIds,
          },
          skipTlsVerify: config.skipTlsVerify,
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
          { skipTlsVerify: config.skipTlsVerify },
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
