import type { ServiceTestResult } from '@/core/types'
import { errMsg } from '@/core/validation'
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

async function plexFetch<T>(
  baseUrl: string,
  token: string,
  path: string,
  options?: { method?: string; body?: URLSearchParams },
): Promise<T> {
  const url = `${baseUrl.replace(/\/+$/, '')}${path}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  let res: Response
  try {
    res = await fetch(url, {
      method: options?.method ?? 'GET',
      headers: {
        'X-Plex-Token': token,
        Accept: 'application/json',
      },
      body: options?.body,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Plex API ${res.status}: ${text}`)
  }
  return (await res.json()) as T
}

export function createPlexPlaylistTarget(
  targetId: number,
  config: PlexPlaylistConfig,
): DestinationTarget {
  const { url, token } = config

  async function getMusicMachineId(): Promise<string> {
    const res = await plexFetch<{
      MediaContainer: { machineIdentifier: string }
    }>(url, token, '/')
    return res.MediaContainer.machineIdentifier
  }

  async function searchTrack(artistName: string, trackName: string): Promise<string | null> {
    try {
      const params = new URLSearchParams({
        query: `${artistName} ${trackName}`,
        limit: '5',
      })
      const res = await plexFetch<PlexHubSearchResponse>(
        url,
        token,
        `/hubs/search?${params.toString()}`,
      )

      const hubs = res.MediaContainer.Hub ?? []
      const trackHub = hubs.find((h) => h.type === 'track')
      const results = trackHub?.Metadata ?? []

      if (results.length === 0) return null

      // Prefer exact artist+title match, fall back to first result
      const exact = results.find((m) => {
        const titleMatch = m.title.toLowerCase() === trackName.toLowerCase()
        const artistMatch = (m.grandparentTitle ?? '').toLowerCase() === artistName.toLowerCase()
        return titleMatch && artistMatch
      })

      return (exact ?? results[0])?.ratingKey ?? null
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

        const created = await plexFetch<PlexPlaylistCreateResponse>(
          url,
          token,
          `/playlists?${qs}`,
          { method: 'POST' },
        )

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
        const res = await plexFetch<{
          MediaContainer: { friendlyName?: string; version?: string; machineIdentifier: string }
        }>(url, token, '/')
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
