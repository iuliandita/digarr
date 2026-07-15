import { createHttpClient, HttpError } from '@/core/clients/http'
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

export function createJellyfinFamilyPlaylistTarget(
  targetId: number,
  config: JellyfinFamilyPlaylistConfig,
  { type, serviceName }: JellyfinFamilyPlaylistOptions,
): DestinationTarget {
  const client = createHttpClient({
    baseUrl: config.url.replace(/\/+$/, ''),
    headers: { 'X-Emby-Token': config.apiKey },
    timeout: 10_000,
    skipTlsVerify: config.skipTlsVerify,
  })

  function rethrowProviderError(error: unknown): never {
    if (error instanceof HttpError) {
      throw new Error(
        `${serviceName} API ${error.status}: ${error.body.replaceAll(config.apiKey, '[REDACTED]')}`,
      )
    }
    throw error
  }

  async function get<T>(path: string): Promise<T> {
    try {
      return await client.get<T>(path)
    } catch (error) {
      rethrowProviderError(error)
    }
  }

  async function postOnce<T>(path: string, body: unknown): Promise<T> {
    try {
      return await client.post<T>(path, body, { retries: 0 })
    } catch (error) {
      rethrowProviderError(error)
    }
  }

  async function searchTrack(artistName: string, trackName: string): Promise<string | null> {
    try {
      const params = new URLSearchParams({
        searchTerm: `${artistName} ${trackName}`,
        IncludeItemTypes: 'Audio',
        Recursive: 'true',
        Limit: '5',
        Fields: 'Name,AlbumArtist,Artists',
      })
      const response = await get<{
        Items: Array<{ Id: string; Name: string; AlbumArtist?: string; Artists?: string[] }>
      }>(`/Users/${config.userId}/Items?${params.toString()}`)

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
      console.warn('playlist search transport error', {
        type,
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

        const playlist = await postOnce<{ Id?: string }>('/Playlists', {
          Name: name,
          UserId: config.userId,
          MediaType: 'Audio',
          Ids: itemIds,
        })
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
        const info = await get<{ ServerName: string; Version: string }>('/System/Info')
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
