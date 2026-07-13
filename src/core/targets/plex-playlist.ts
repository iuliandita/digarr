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
    headers: { 'X-Plex-Token': token, Accept: 'application/json' },
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

  async function getMusicMachineId(): Promise<string> {
    const res = await get<{
      MediaContainer: { machineIdentifier: string }
    }>('/')
    return res.MediaContainer.machineIdentifier
  }

  async function searchTrack(artistName: string, trackName: string): Promise<string | null> {
    try {
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
    } catch {
      return null
    }
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
        // Resolve Plex rating keys for items that have a trackName
        const ratingKeys: string[] = []
        for (const item of items) {
          if (!item.trackName) continue
          const key = await searchTrack(item.artistName, item.trackName)
          if (key) ratingKeys.push(key)
        }

        const machineId = await getMusicMachineId()

        // Build uri list for Plex playlist creation
        // Format: server://{machineId}/com.plexapp.plugins.library/library/metadata/{ratingKey}
        const uris = ratingKeys.map(
          (key) => `server://${machineId}/com.plexapp.plugins.library/library/metadata/${key}`,
        )

        const baseParams = new URLSearchParams({ type: 'audio', title: name, smart: '0' })
        const uriParam = uris.map((u) => `uri=${encodeURIComponent(u)}`).join('&')
        const qs = uris.length > 0 ? `${baseParams.toString()}&${uriParam}` : baseParams.toString()

        const created = await postOnce<PlexPlaylistCreateResponse>(`/playlists?${qs}`)

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
        const res = await get<{
          MediaContainer: { friendlyName?: string; version?: string; machineIdentifier: string }
        }>('/')
        const info = res.MediaContainer
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
