import type { ServiceTestResult } from '@/core/types'
import { errMsg } from '@/core/validation'
import { pickBestTrackMatch } from './playlist-match'
import type { DestinationTarget, PlaylistItem, PlaylistResult, TargetType } from './types'

export type JellyfinFamilyPlaylistConfig = {
  url: string
  apiKey: string
  userId: string
  skipTlsVerify?: boolean
}

type JellyfinFamilyPlaylistOptions = {
  type: Extract<TargetType, 'emby-playlist' | 'jellyfin-playlist'>
  serviceName: 'Emby' | 'Jellyfin'
}

async function jellyfinFamilyFetch<T>(
  config: JellyfinFamilyPlaylistConfig,
  serviceName: string,
  path: string,
  options?: { method?: string; body?: unknown },
): Promise<T> {
  const url = `${config.url.replace(/\/+$/, '')}${path}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  let response: Response
  try {
    response = await fetch(url, {
      method: options?.method ?? 'GET',
      headers: {
        'X-Emby-Token': config.apiKey,
        'Content-Type': 'application/json',
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
      ...(config.skipTlsVerify ? { tls: { rejectUnauthorized: false } } : {}),
    })
  } finally {
    clearTimeout(timer)
  }
  if (!response.ok) {
    throw new Error(`${serviceName} API ${response.status}: ${await response.text()}`)
  }
  return (await response.json()) as T
}

export function createJellyfinFamilyPlaylistTarget(
  targetId: number,
  config: JellyfinFamilyPlaylistConfig,
  { type, serviceName }: JellyfinFamilyPlaylistOptions,
): DestinationTarget {
  async function searchTrack(artistName: string, trackName: string): Promise<string | null> {
    try {
      const params = new URLSearchParams({
        searchTerm: `${artistName} ${trackName}`,
        IncludeItemTypes: 'Audio',
        Recursive: 'true',
        Limit: '5',
        Fields: 'Name,AlbumArtist,Artists',
      })
      const response = await jellyfinFamilyFetch<{
        Items: Array<{ Id: string; Name: string; AlbumArtist?: string; Artists?: string[] }>
      }>(config, serviceName, `/Users/${config.userId}/Items?${params.toString()}`)

      return pickBestTrackMatch(
        (response.Items ?? []).map((item) => ({
          id: item.Id,
          title: item.Name,
          artists: [item.AlbumArtist, ...(item.Artists ?? [])].filter((artist): artist is string =>
            Boolean(artist),
          ),
        })),
        artistName,
        trackName,
      )
    } catch (error) {
      console.warn(`[${type}] searchTrack transport error:`, {
        artistName,
        trackName,
        error: errMsg(error),
      })
      return null
    }
  }

  return {
    id: `${type}-${targetId}`,
    name: `${serviceName} Playlist`,
    type,
    capabilities: ['createPlaylist'],

    async createPlaylist(name: string, items: PlaylistItem[]): Promise<PlaylistResult> {
      try {
        const itemIds: string[] = []
        for (const item of items) {
          if (!item.trackName) continue
          const itemId = await searchTrack(item.artistName, item.trackName)
          if (itemId) itemIds.push(itemId)
        }

        const playlist = await jellyfinFamilyFetch<{ Id?: string }>(
          config,
          serviceName,
          '/Playlists',
          {
            method: 'POST',
            body: {
              Name: name,
              UserId: config.userId,
              MediaType: 'Audio',
              Ids: itemIds,
            },
          },
        )
        const playlistId = playlist.Id
        if (!playlistId) {
          throw new Error(`${serviceName} did not return a playlist ID`)
        }

        return {
          success: true,
          targetType: type,
          targetId,
          playlistId,
          playlistName: name,
          itemsAdded: itemIds.length,
        }
      } catch (error) {
        return {
          success: false,
          targetType: type,
          targetId,
          error: errMsg(error),
        }
      }
    },

    async testConnection(): Promise<ServiceTestResult> {
      try {
        const info = await jellyfinFamilyFetch<{ ServerName: string; Version: string }>(
          config,
          serviceName,
          '/System/Info',
        )
        return {
          success: true,
          message: `Connected to ${serviceName} "${info.ServerName}" v${info.Version}`,
          details: { serverName: info.ServerName, version: info.Version },
        }
      } catch (error) {
        return { success: false, message: errMsg(error) }
      }
    },
  }
}
