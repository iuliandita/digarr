import { createHttpClient, HttpError } from '@/core/clients/http'
import type { ServiceTestResult } from '@/core/types'
import { errMsg } from '@/core/validation'
import { pickBestTrackMatch } from './playlist-match'
import { createPlaylistScope, playlistEndpoint } from './playlist-scope'
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
  const { url, apiKey, userId, skipTlsVerify } = config
  const client = createHttpClient({
    baseUrl: url.replace(/\/+$/, ''),
    headers: { 'X-Emby-Token': apiKey },
    timeout: 10_000,
    skipTlsVerify,
  })

  function redact(message: string): string {
    return apiKey ? message.replaceAll(apiKey, '[REDACTED]') : message
  }

  function validId(value: unknown): value is string {
    return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,256}$/.test(value)
  }

  function identity(value: string): string {
    return /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(value)
      ? value.replaceAll('-', '').toLowerCase()
      : value
  }

  function rethrowProviderError(error: unknown): never {
    if (error instanceof HttpError) {
      throw new Error(`${serviceName} API ${error.status}: ${redact(error.body)}`)
    }
    throw new Error(redact(errMsg(error)))
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
    const params = new URLSearchParams({
      searchTerm: `${artistName} ${trackName}`,
      IncludeItemTypes: 'Audio',
      Recursive: 'true',
      Limit: '5',
      Fields: 'Name,AlbumArtist,Artists',
    })
    const response = await get<{
      Items: Array<{ Id: string; Name: string; AlbumArtist?: string; Artists?: string[] }>
    }>(`/Users/${encodeURIComponent(userId)}/Items?${params.toString()}`)

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
  }

  async function resolveItems(items: PlaylistItem[], validateIds = false): Promise<string[]> {
    const ids: string[] = []
    for (const item of items) {
      if (!item.trackName?.trim()) continue
      const id = await searchTrack(item.artistName, item.trackName)
      if (id) {
        if (validateIds && !validId(id))
          throw new Error(`${serviceName} returned an invalid track ID`)
        ids.push(id)
      }
    }
    return ids
  }

  function failure(error: unknown, playlistId?: string): PlaylistResult {
    return { success: false, targetType: type, targetId, playlistId, error: redact(errMsg(error)) }
  }

  return {
    id: `${type}-${targetId}`,
    name: `${serviceName} Playlist`,
    type,
    capabilities: ['createPlaylist'],

    async createPlaylist(name: string, items: PlaylistItem[]): Promise<PlaylistResult> {
      try {
        const itemIds = await resolveItems(items)

        const playlist = await postOnce<{ Id?: string }>('/Playlists', {
          Name: name,
          UserId: userId,
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
          itemsSkipped: items.length - itemIds.length,
        }
      } catch (error) {
        return failure(error)
      }
    },

    async openPlaylistExportSession(items) {
      try {
        if (items.length === 0) throw new Error('No playlist tracks were provided')
        const info = await get<{ Id?: string }>('/System/Info')
        if (!validId(info.Id)) throw new Error(`${serviceName} did not return a server ID`)
        const user = await get<{ Id?: string; ServerId?: string }>(
          `/Users/${encodeURIComponent(userId)}`,
        )
        if (!validId(user.Id) || identity(user.Id) !== identity(userId)) {
          throw new Error(`${serviceName} returned a different playlist user`)
        }
        if (user.ServerId !== undefined && user.ServerId !== info.Id) {
          throw new Error(`${serviceName} returned a different server for the playlist user`)
        }
        const itemIds = await resolveItems(items, true)
        if (itemIds.length === 0) {
          throw new Error(`No playlist tracks were found in the ${serviceName} library`)
        }
        const scope = createPlaylistScope(type, [playlistEndpoint(url), info.Id, identity(user.Id)])
        const success = (playlistId: string, name: string): PlaylistResult => ({
          success: true,
          targetType: type,
          targetId,
          playlistId,
          playlistName: name,
          itemsAdded: itemIds.length,
          itemsSkipped: items.length - itemIds.length,
        })
        return {
          scope,
          async createPlaylist(name, onCreated) {
            let playlistId: string | undefined
            try {
              const playlist = await postOnce<{ Id?: string }>('/Playlists', {
                Name: name,
                UserId: userId,
                MediaType: 'Audio',
                Ids: itemIds,
              })
              if (!validId(playlist.Id))
                throw new Error(`${serviceName} did not return a playlist ID`)
              playlistId = playlist.Id
              await onCreated(playlistId)
              return success(playlistId, name)
            } catch (error) {
              return failure(error, playlistId)
            }
          },
          async replacePlaylist(playlistId, _name) {
            try {
              if (!validId(playlistId)) throw new Error('Invalid playlist ID')
              const encodedId = encodeURIComponent(playlistId)
              const playlist = await get<{
                Id?: string
                Type?: string
                MediaType?: string
                Name?: string
              }>(`/Users/${encodeURIComponent(userId)}/Items/${encodedId}`)
              if (
                playlist.Id !== playlistId ||
                playlist.Type !== 'Playlist' ||
                playlist.MediaType !== 'Audio'
              ) {
                throw new Error(`${serviceName} destination is not the expected audio playlist`)
              }
              const entryIds: string[] = []
              const seen = new Set<string>()
              let total: number | undefined
              // Bound the read before any removal so oversized playlists stay untouched.
              for (let page = 0; page < 100; page++) {
                const params = new URLSearchParams({
                  UserId: userId,
                  StartIndex: String(entryIds.length),
                  Limit: '200',
                })
                const result = await get<{
                  Items?: Array<{ PlaylistItemId?: string }>
                  TotalRecordCount?: number
                }>(`/Playlists/${encodedId}/Items?${params}`)
                if (
                  !Number.isSafeInteger(result.TotalRecordCount) ||
                  (result.TotalRecordCount ?? -1) < 0 ||
                  !Array.isArray(result.Items) ||
                  result.Items.length > 200 ||
                  (total !== undefined && result.TotalRecordCount !== total)
                ) {
                  throw new Error(`${serviceName} returned incomplete playlist entries`)
                }
                total = result.TotalRecordCount
                for (const entry of result.Items) {
                  if (!validId(entry.PlaylistItemId) || seen.has(entry.PlaylistItemId)) {
                    throw new Error(`${serviceName} returned invalid or repeated playlist entries`)
                  }
                  seen.add(entry.PlaylistItemId)
                  entryIds.push(entry.PlaylistItemId)
                }
                if (entryIds.length === total) break
                if (entryIds.length > (total ?? 0) || result.Items.length === 0 || page === 99) {
                  throw new Error(`${serviceName} returned incomplete playlist entries`)
                }
              }
              if (entryIds.length) {
                const params = new URLSearchParams({ EntryIds: entryIds.join(',') })
                await client.delete(`/Playlists/${encodedId}/Items?${params}`, { retries: 0 })
              }
              const params = new URLSearchParams({ Ids: itemIds.join(','), UserId: userId })
              await client.postVoid(`/Playlists/${encodedId}/Items?${params}`, undefined, {
                retries: 0,
              })
              return success(playlistId, playlist.Name ?? '')
            } catch (error) {
              if (error instanceof HttpError) {
                return failure(
                  new Error(`${serviceName} API ${error.status}: ${error.body}`),
                  playlistId,
                )
              }
              return failure(error, playlistId)
            }
          },
        }
      } catch (error) {
        rethrowProviderError(error)
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
