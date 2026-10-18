import { createHash } from 'node:crypto'
import { createHttpClient, HttpError } from '@/core/clients/http'
import type { ServiceTestResult } from '@/core/types'
import { errMsg } from '@/core/validation'
import { pickBestTrackMatch } from './playlist-match'
import { createPlaylistScope, playlistEndpoint } from './playlist-scope'
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

  function redact(message: string): string {
    return token ? message.replaceAll(token, '[REDACTED]') : message
  }

  function validId(value: unknown): value is string {
    return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,256}$/.test(value)
  }

  function rethrowPlexError(error: unknown): never {
    if (error instanceof HttpError) {
      throw new Error(`Plex API ${error.status}: ${redact(error.body)}`)
    }
    throw new Error(redact(errMsg(error)))
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

  async function resolveItems(items: PlaylistItem[], validateIds = false): Promise<string[]> {
    const keys: string[] = []
    for (const item of items) {
      if (!item.trackName?.trim()) continue
      const key = await searchTrack(item.artistName, item.trackName)
      if (key) {
        if (validateIds && !validId(key)) throw new Error('Plex returned an invalid track ID')
        keys.push(key)
      }
    }
    if (keys.length === 0) throw new Error('No playlist tracks were found in the Plex library')
    return keys
  }

  function contentUri(machineId: string, keys: string[]): string {
    return `server://${machineId}/com.plexapp.plugins.library/library/metadata/${keys.join(',')}`
  }

  function failure(error: unknown, playlistId?: string): PlaylistResult {
    return {
      success: false,
      targetType: 'plex-playlist',
      targetId,
      playlistId,
      error: redact(errMsg(error)),
    }
  }

  return {
    id: `plex-playlist-${targetId}`,
    name: 'Plex Playlist',
    type: 'plex-playlist',
    capabilities: ['createPlaylist'],

    async openPlaylistExportSession(items) {
      try {
        if (items.length === 0) throw new Error('No playlist tracks were provided')
        const { machineIdentifier } = await getServerInfo()
        if (!validId(machineIdentifier))
          throw new Error('Plex did not return a server machine identifier')
        const ratingKeys = await resolveItems(items, true)
        const fingerprint = createHash('sha256')
          .update(JSON.stringify(['plex-playlist-token', token]))
          .digest('hex')
        const scope = createPlaylistScope('plex-playlist', [
          playlistEndpoint(url),
          machineIdentifier,
          fingerprint,
        ])
        const success = (playlistId: string, name: string): PlaylistResult => ({
          success: true,
          targetType: 'plex-playlist',
          targetId,
          playlistId,
          playlistName: name,
          itemsAdded: ratingKeys.length,
          itemsSkipped: items.length - ratingKeys.length,
        })
        return {
          scope,
          async createPlaylist(name, onCreated) {
            let playlistId: string | undefined
            try {
              const params = new URLSearchParams({
                type: 'audio',
                title: name,
                smart: '0',
                uri: contentUri(machineIdentifier, ratingKeys),
              })
              const response = await postOnce<PlexPlaylistCreateResponse>(`/playlists?${params}`)
              const playlist = response.MediaContainer?.Metadata?.[0]
              if (!playlist || !validId(playlist.ratingKey)) {
                throw new Error('Plex did not return a playlist after creation')
              }
              playlistId = playlist.ratingKey
              await onCreated(playlistId)
              return success(playlistId, playlist.title)
            } catch (error) {
              return failure(error, playlistId)
            }
          },
          async replacePlaylist(playlistId, _name) {
            try {
              if (!validId(playlistId)) throw new Error('Invalid playlist ID')
              const path = `/playlists/${encodeURIComponent(playlistId)}`
              const response = await get<{
                MediaContainer?: {
                  Metadata?: Array<{
                    ratingKey?: string
                    type?: string
                    playlistType?: string
                    smart?: boolean | number | string
                    title?: string
                  }>
                }
              }>(path)
              const playlist = response.MediaContainer?.Metadata?.[0]
              if (
                !playlist ||
                playlist.ratingKey !== playlistId ||
                playlist.type !== 'playlist' ||
                playlist.playlistType !== 'audio' ||
                ![false, 0, '0'].includes(playlist.smart ?? '')
              ) {
                throw new Error(
                  'Plex destination is not the expected audio playlist with a fixed track list',
                )
              }
              await client.delete(`${path}/items`, { retries: 0 })
              const params = new URLSearchParams({ uri: contentUri(machineIdentifier, ratingKeys) })
              await client.putVoid(`${path}/items?${params}`, undefined, { retries: 0 })
              return success(playlistId, playlist.title ?? '')
            } catch (error) {
              if (error instanceof HttpError) {
                return failure(new Error(`Plex API ${error.status}: ${error.body}`), playlistId)
              }
              return failure(error, playlistId)
            }
          },
          async readBackTrackCount(playlistId) {
            if (!validId(playlistId)) throw new Error('Invalid playlist ID')
            const response = await get<{
              MediaContainer?: { Metadata?: Array<{ ratingKey?: string; leafCount?: number }> }
            }>(`/playlists/${encodeURIComponent(playlistId)}`)
            const playlist = response.MediaContainer?.Metadata?.[0]
            if (playlist?.ratingKey !== playlistId || !Number.isSafeInteger(playlist.leafCount))
              throw new Error('Plex did not return the playlist track count')
            return playlist.leafCount as number
          },
        }
      } catch (error) {
        rethrowPlexError(error)
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
