import { createHttpClient, HttpError, type HttpRequestOptions } from '@/core/clients/http'
import {
  buildSubsonicAuthParams,
  type SubsonicEnvelope,
  unwrapSubsonicResponse,
} from '@/core/clients/subsonic-auth'
import type { ServiceTestResult } from '@/core/types'
import { errMsg } from '@/core/validation'
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
  extra?: Record<string, string>,
): string {
  const params = buildSubsonicAuthParams({
    username,
    password,
    extra,
  })
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

  function apiPath(endpoint: string, extra?: Record<string, string>): string {
    return buildSubsonicPath(username, password, endpoint, extra)
  }

  async function subsonicFetch<T>(path: string, options?: HttpRequestOptions): Promise<T> {
    let data: SubsonicEnvelope<Record<string, unknown>>
    try {
      data = await client.get<SubsonicEnvelope<Record<string, unknown>>>(path, options)
    } catch (error) {
      if (error instanceof HttpError) {
        throw new Error(
          `Subsonic HTTP ${error.status}: ${redactSubsonicAuthValues(error.body, path)}`,
        )
      }
      throw error
    }
    const root = unwrapSubsonicResponse(data)
    return root as unknown as T
  }

  async function searchTrack(artistName: string, trackName: string): Promise<string | null> {
    try {
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
      if (songs.length === 0) return null

      // Prefer exact artist+title match, fall back to first result
      const exact = songs.find(
        (s) =>
          s.title.toLowerCase() === trackName.toLowerCase() &&
          s.artist.toLowerCase() === artistName.toLowerCase(),
      )
      return (exact ?? songs[0])?.id ?? null
    } catch {
      return null
    }
  }

  return {
    id: `navidrome-playlist-${targetId}`,
    name: 'Navidrome Playlist',
    type: 'navidrome-playlist',
    capabilities: ['createPlaylist'],

    async createPlaylist(
      name: string,
      items: PlaylistItem[],
      options?: { description?: string; public?: boolean; replace?: boolean },
    ): Promise<PlaylistResult> {
      try {
        // Resolve song IDs for items that have a trackName
        const songIds: string[] = []
        for (const item of items) {
          if (!item.trackName) continue
          const id = await searchTrack(item.artistName, item.trackName)
          if (id) songIds.push(id)
        }

        // Create the playlist
        const createPath = apiPath('createPlaylist', { name })
        const created = await subsonicFetch<{
          playlist: { id: string; name: string }
        }>(createPath, { retries: 0 })

        const playlistId = created.playlist?.id
        if (!playlistId) {
          throw new Error('Navidrome did not return a playlist ID')
        }

        // Add songs if any were resolved
        if (songIds.length > 0) {
          const updateParams: Record<string, string> = { playlistId }
          songIds.forEach((id, i) => {
            updateParams[`songIdToAdd[${i}]`] = id
          })
          const updatePath = apiPath('updatePlaylist', updateParams)
          await subsonicFetch(updatePath, { retries: 0 })
        }

        if (options?.description) {
          const commentPath = apiPath('updatePlaylist', {
            playlistId,
            comment: options.description,
          })
          await subsonicFetch(commentPath).catch(() => {
            // Best-effort: description update is not critical
          })
        }

        return {
          success: true,
          targetType: 'navidrome-playlist',
          targetId,
          playlistId,
          playlistName: name,
          itemsAdded: songIds.length,
        }
      } catch (err: unknown) {
        return {
          success: false,
          targetType: 'navidrome-playlist',
          targetId,
          error: errMsg(err),
        }
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
          message: errMsg(err),
        }
      }
    },
  }
}
