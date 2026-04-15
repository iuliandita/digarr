import { createHash, randomBytes } from 'node:crypto'
import type { ServiceTestResult } from '@/core/types'
import { errMsg } from '@/core/validation'
import type { DestinationTarget, PlaylistItem, PlaylistResult } from './types'

export type NavidromePlaylistConfig = {
  url: string
  username: string
  password: string
}

const SUBSONIC_API_VERSION = '1.16.1'
const SUBSONIC_CLIENT = 'digarr'

function buildSubsonicUrl(
  baseUrl: string,
  username: string,
  password: string,
  endpoint: string,
  extra?: Record<string, string>,
): string {
  const base = baseUrl.replace(/\/+$/, '')
  const salt = randomBytes(8).toString('hex')
  // Subsonic API spec mandates md5(password + salt) auth - no alternative
  const token = createHash('md5') // lgtm[js/insufficient-password-hash]
    .update(password + salt)
    .digest('hex')
  const params = new URLSearchParams({
    u: username,
    t: token,
    s: salt,
    v: SUBSONIC_API_VERSION,
    c: SUBSONIC_CLIENT,
    f: 'json',
    ...extra,
  })
  return `${base}/rest/${endpoint}?${params.toString()}`
}

async function subsonicFetch<T>(url: string): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  let res: Response
  try {
    res = await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) {
    throw new Error(`Subsonic HTTP ${res.status}: ${url}`)
  }
  const data = (await res.json()) as {
    'subsonic-response': {
      status: string
      error?: { code: number; message: string }
    } & Record<string, unknown>
  }
  const root = data['subsonic-response']
  if (root.status !== 'ok') {
    const msg = root.error?.message ?? `Subsonic error code ${root.error?.code ?? 'unknown'}`
    throw new Error(msg)
  }
  return root as unknown as T
}

export function createNavidromePlaylistTarget(
  targetId: number,
  config: NavidromePlaylistConfig,
): DestinationTarget {
  const { url, username, password } = config

  function apiUrl(endpoint: string, extra?: Record<string, string>): string {
    return buildSubsonicUrl(url, username, password, endpoint, extra)
  }

  async function searchTrack(artistName: string, trackName: string): Promise<string | null> {
    try {
      const query = `${artistName} ${trackName}`
      const searchUrl = apiUrl('search3', {
        query,
        songCount: '5',
        artistCount: '0',
        albumCount: '0',
      })
      const res = await subsonicFetch<{
        searchResult3?: { song?: Array<{ id: string; title: string; artist: string }> }
      }>(searchUrl)

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
        const createUrl = apiUrl('createPlaylist', { name })
        const created = await subsonicFetch<{
          playlist: { id: string; name: string }
        }>(createUrl)

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
          const updateUrl = apiUrl('updatePlaylist', updateParams)
          await subsonicFetch(updateUrl)
        }

        if (options?.description) {
          const commentUrl = apiUrl('updatePlaylist', {
            playlistId,
            comment: options.description,
          })
          await subsonicFetch(commentUrl).catch(() => {
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
        const pingUrl = apiUrl('ping')
        await subsonicFetch(pingUrl)
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
