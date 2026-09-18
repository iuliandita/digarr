import { createHttpClient, HttpError } from '@/core/clients/http'
import type { ServiceTestResult } from '@/core/types'
import { errMsg } from '@/core/validation'
import { pickBestTrackMatch } from './playlist-match'
import type { DestinationTarget, PlaylistItem, PlaylistResult } from './types'

export type PlexPlaylistConfig = {
  url: string
  token: string
}

type PlexHubSearchResponse = {
  MediaContainer: {
    Hub?: Array<{
      type: string
      Metadata?: Array<{
        ratingKey: string
        title: string
        grandparentTitle?: string
        type: string
      }>
    }>
  }
}

type PlexPlaylistCreateResponse = {
  MediaContainer: {
    Metadata?: Array<{ ratingKey: string; title: string }>
  }
}

export function createPlexPlaylistTarget(
  targetId: number,
  config: PlexPlaylistConfig,
): DestinationTarget {
  const { url, token } = config
  const client = createHttpClient({
    baseUrl: url.replace(/\/+$/, ''),
    headers: {
      'X-Plex-Token': token,
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    timeout: 10_000,
  })

  function rethrowPlexError(error: unknown): never {
    if (error instanceof HttpError) {
      throw new Error(`Plex API ${error.status}: ${error.body.replaceAll(token, '[REDACTED]')}`)
    }
    throw error
  }

  async function get<T>(path: string): Promise<T> {
    try {
      return await client.get<T>(path)
    } catch (error) {
      rethrowPlexError(error)
    }
  }

  async function postOnce<T>(path: string): Promise<T> {
    try {
      return await client.post<T>(path, undefined, { retries: 0 })
    } catch (error) {
      rethrowPlexError(error)
    }
  }

  async function getServerInfo() {
    const res = await get<{
      MediaContainer: { friendlyName?: string; version?: string; machineIdentifier: string }
    }>('/')
    const id = res.MediaContainer?.machineIdentifier
    if (typeof id !== 'string' || !id.trim()) {
      throw new Error('Plex did not return a server machine identifier')
    }
    return res.MediaContainer
  }

  async function searchTrack(artistName: string, trackName: string): Promise<string | null> {
    const params = new URLSearchParams({
      query: `${artistName} ${trackName}`,
      limit: '5',
    })
    const res = await get<PlexHubSearchResponse>(`/hubs/search?${params.toString()}`)

    const hubs = res.MediaContainer.Hub ?? []
    const trackHub = hubs.find((h) => h.type === 'track')
    const results = trackHub?.Metadata ?? []
    return pickBestTrackMatch(
      results.map((result) => ({
        id: result.ratingKey,
        title: result.title,
        artists: result.grandparentTitle ? [result.grandparentTitle] : [],
      })),
      artistName,
      trackName,
    )
  }

  return {
    id: `plex-playlist-${targetId}`,
    name: 'Plex Playlist',
    type: 'plex-playlist',
    capabilities: ['createPlaylist'],

    async createPlaylist(
      name: string,
      items: PlaylistItem[],
      _options?: { description?: string; public?: boolean; replace?: boolean },
    ): Promise<PlaylistResult> {
      try {
        const ratingKeys: string[] = []
        for (const item of items) {
          if (!item.trackName) continue
          const key = await searchTrack(item.artistName, item.trackName)
          if (key) ratingKeys.push(key)
        }

        if (ratingKeys.length === 0) {
          throw new Error('No playlist tracks were found in the Plex library')
        }
        const { machineIdentifier: machineId } = await getServerInfo()
        const params = new URLSearchParams({
          type: 'audio',
          title: name,
          smart: '0',
          uri: `server://${machineId}/com.plexapp.plugins.library/library/metadata/${ratingKeys.join(',')}`,
        })

        const created = await postOnce<PlexPlaylistCreateResponse>(`/playlists?${params}`)

        const playlist = created.MediaContainer.Metadata?.[0]
        if (!playlist) {
          throw new Error('Plex did not return a playlist after creation')
        }

        return {
          success: true,
          targetType: 'plex-playlist',
          targetId,
          playlistId: playlist.ratingKey,
          playlistName: playlist.title,
          itemsAdded: ratingKeys.length,
        }
      } catch (err: unknown) {
        return {
          success: false,
          targetType: 'plex-playlist',
          targetId,
          error: errMsg(err),
        }
      }
    },

    async testConnection(): Promise<ServiceTestResult> {
      try {
        const info = await getServerInfo()
        const label = info.friendlyName ?? info.machineIdentifier
        return {
          success: true,
          message: `Connected to Plex "${label}"${info.version ? ` v${info.version}` : ''}`,
          details: { machineIdentifier: info.machineIdentifier, version: info.version },
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
