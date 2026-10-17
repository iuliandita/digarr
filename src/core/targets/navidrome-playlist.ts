import { createHttpClient, HttpError, type HttpRequestOptions } from '@/core/clients/http'
import {
  buildSubsonicAuthParams,
  type SubsonicEnvelope,
  unwrapSubsonicResponse,
} from '@/core/clients/subsonic-auth'
import type { ServiceTestResult } from '@/core/types'
import { errMsg, redactSecrets } from '@/core/validation'
import { pickBestTrackMatch } from './playlist-match'
import { createPlaylistScope, playlistEndpoint } from './playlist-scope'
import type { DestinationTarget, PlaylistItem, PlaylistResult } from './types'

export type NavidromePlaylistConfig = {
  url: string
  username: string
  password: string
}

function buildSubsonicPath(
  username: string,
  password: string,
  endpoint: string,
  extra?: Record<string, string | string[]>,
): string {
  const params = buildSubsonicAuthParams({
    username,
    password,
  })
  for (const [key, value] of Object.entries(extra ?? {})) {
    for (const entry of Array.isArray(value) ? value : [value]) params.append(key, entry)
  }
  return `/rest/${endpoint}?${params.toString()}`
}

function redactSubsonicAuthValues(text: string, path: string): string {
  const params = new URL(path, 'http://subsonic.invalid').searchParams
  let redacted = text
  for (const key of ['t', 's']) {
    const value = params.get(key)
    if (value) redacted = redacted.replaceAll(value, '[REDACTED]')
  }
  return redacted
}

export function createNavidromePlaylistTarget(
  targetId: number,
  config: NavidromePlaylistConfig,
): DestinationTarget {
  const { url, username, password } = config
  const client = createHttpClient({ baseUrl: url.replace(/\/+$/, ''), timeout: 10_000 })

  function redactError(error: unknown): string {
    let message = redactSecrets(errMsg(error))
    for (const value of [password, username]) {
      if (value) {
        message = message.replaceAll(value, '[REDACTED]')
        message = message.replaceAll(encodeURIComponent(value), '[REDACTED]')
      }
    }
    return message.replaceAll('[redacted]', '[REDACTED]')
  }

  function apiPath(endpoint: string, extra?: Record<string, string | string[]>): string {
    return buildSubsonicPath(username, password, endpoint, extra)
  }

  async function subsonicFetch<T>(path: string, options?: HttpRequestOptions): Promise<T> {
    let data: SubsonicEnvelope<Record<string, unknown>>
    try {
      data = await client.get<SubsonicEnvelope<Record<string, unknown>>>(path, options)
    } catch (error) {
      if (error instanceof HttpError) {
        throw new Error(
          `Subsonic HTTP ${error.status}: ${redactSubsonicAuthValues(redactError(error.body), path)}`,
        )
      }
      throw new Error(redactSubsonicAuthValues(redactError(error), path))
    }
    try {
      const root = unwrapSubsonicResponse(data)
      return root as unknown as T
    } catch (error) {
      throw new Error(redactSubsonicAuthValues(redactError(error), path))
    }
  }

  async function searchTrack(artistName: string, trackName: string): Promise<string | null> {
    const query = `${artistName} ${trackName}`
    const searchPath = apiPath('search3', {
      query,
      songCount: '5',
      artistCount: '0',
      albumCount: '0',
    })
    const res = await subsonicFetch<{
      searchResult3?: { song?: Array<{ id: string; title: string; artist: string }> }
    }>(searchPath)

    const songs = res.searchResult3?.song ?? []
    return pickBestTrackMatch(
      songs.map((song) => ({ id: song.id, title: song.title, artists: [song.artist] })),
      artistName,
      trackName,
    )
  }

  async function resolveTracks(items: PlaylistItem[]): Promise<string[]> {
    const songIds: string[] = []
    for (const item of items) {
      if (!item.trackName?.trim()) continue
      const id = await searchTrack(item.artistName, item.trackName)
      if (id !== null) {
        if (typeof id !== 'string' || !id.trim()) throw new Error('Invalid Navidrome song ID')
        songIds.push(id)
      }
    }
    return songIds
  }

  function failure(error: unknown, playlistId?: string): PlaylistResult {
    return {
      success: false,
      targetType: 'navidrome-playlist',
      targetId,
      ...(playlistId ? { playlistId } : {}),
      error: redactError(error),
    }
  }

  function result(
    playlistId: string,
    name: string,
    songIds: string[],
    itemCount: number,
  ): PlaylistResult {
    return {
      success: true,
      targetType: 'navidrome-playlist',
      targetId,
      playlistId,
      playlistName: name,
      itemsAdded: songIds.length,
      itemsSkipped: itemCount - songIds.length,
    }
  }

  async function createPrepared(
    name: string,
    songIds: string[],
    itemCount: number,
    onCreated: (playlistId: string) => Promise<void>,
  ): Promise<PlaylistResult> {
    let playlistId: string | undefined
    try {
      const created = await subsonicFetch<{ playlist?: { id?: string } }>(
        apiPath('createPlaylist', { name }),
        { retries: 0 },
      )
      if (typeof created.playlist?.id !== 'string' || !created.playlist.id.trim()) {
        throw new Error('Navidrome did not return a playlist ID')
      }
      playlistId = created.playlist.id
      await onCreated(playlistId)
      if (songIds.length > 0) {
        await subsonicFetch(apiPath('updatePlaylist', { playlistId, songIdToAdd: songIds }), {
          retries: 0,
        })
      }
      return result(playlistId, name, songIds, itemCount)
    } catch (error) {
      return failure(error, playlistId)
    }
  }

  return {
    id: `navidrome-playlist-${targetId}`,
    name: 'Navidrome Playlist',
    type: 'navidrome-playlist',
    capabilities: ['createPlaylist'],

    async openPlaylistExportSession(items) {
      const itemCount = items.length
      try {
        const user = await subsonicFetch<{ user?: { username?: string } }>(
          apiPath('getUser', { username }),
        )
        if (!username.trim() || user.user?.username !== username) {
          throw new Error('Navidrome did not verify the export username')
        }
        const scope = createPlaylistScope('navidrome-playlist', [playlistEndpoint(url), username])
        const songIds = await resolveTracks(items)
        if (songIds.length === 0) throw new Error('No usable Navidrome tracks to export')
        return {
          scope,
          createPlaylist: (name, onCreated) => createPrepared(name, songIds, itemCount, onCreated),
          async replacePlaylist(playlistId, name) {
            try {
              const current = await subsonicFetch<{ playlist?: { id?: string; owner?: string } }>(
                apiPath('getPlaylist', { id: playlistId }),
              )
              if (current.playlist?.id !== playlistId || current.playlist.owner !== username) {
                throw new Error('Navidrome playlist owner does not match the export account')
              }
              const replaced = await subsonicFetch<{ playlist?: { id?: string } }>(
                apiPath('createPlaylist', { playlistId, songId: songIds }),
                { retries: 0 },
              )
              if (replaced.playlist?.id !== playlistId) {
                throw new Error('Navidrome did not return the replaced playlist ID')
              }
              await subsonicFetch(apiPath('updatePlaylist', { playlistId, name }), { retries: 0 })
              return result(playlistId, name, songIds, itemCount)
            } catch (error) {
              return failure(error, playlistId)
            }
          },
        }
      } catch (error) {
        throw new Error(redactError(error))
      }
    },

    async testConnection(): Promise<ServiceTestResult> {
      try {
        const pingPath = apiPath('ping')
        await subsonicFetch(pingPath)
        return {
          success: true,
          message: `Connected to Navidrome as ${username}`,
        }
      } catch (err: unknown) {
        return {
          success: false,
          message: redactError(err),
        }
      }
    },
  }
}
