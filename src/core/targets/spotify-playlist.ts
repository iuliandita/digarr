import type { ServiceTestResult } from '@/core/types'
import { errMsg, redactSecrets } from '@/core/validation'
import { TRACKS_PER_ARTIST } from '../playlists/strategies/types'
import { createPlaylistScope } from './playlist-scope'
import type { DestinationTarget, PlaylistItem, PlaylistResult } from './types'

const SPOTIFY_API = 'https://api.spotify.com'
const TRACKS_PER_BATCH = 100
const SPOTIFY_TRACK_URI = /^spotify:track:[A-Za-z0-9]{22}$/

type SpotifyTrack = {
  uri: string
  name: string
  artists: Array<{ name: string }>
}

type SpotifyTrackSearchResponse = {
  tracks: { items: SpotifyTrack[] }
}

type SpotifyPlaylistResponse = {
  id: string
  name: string
}

type SpotifyAddItemsResponse = {
  snapshot_id: string
}

export type SpotifyPlaylistConfig = {
  getAccessToken: () => Promise<string>
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function hasArtist(track: SpotifyTrack, artistName: string): boolean {
  const expected = normalize(artistName)
  return track.artists.some((artist) => normalize(artist.name) === expected)
}

function isExactTrackMatch(track: SpotifyTrack, artistName: string, trackName: string): boolean {
  return normalize(track.name) === normalize(trackName) && hasArtist(track, artistName)
}

function redactSpotifyError(error: unknown, accessToken?: string): string {
  const message = redactSecrets(errMsg(error))
  return accessToken ? message.replaceAll(accessToken, '[redacted]') : message
}

function assertValidTrackUri(uri: string, source: string): void {
  if (!SPOTIFY_TRACK_URI.test(uri)) {
    throw new Error(`Invalid Spotify track URI ${source}`)
  }
}

function hasPlaylistIdentity(playlist: SpotifyPlaylistResponse): boolean {
  return (
    typeof playlist.id === 'string' &&
    playlist.id.trim().length > 0 &&
    typeof playlist.name === 'string' &&
    playlist.name.trim().length > 0
  )
}

async function spotifyFetch<T>(
  accessToken: string,
  path: string,
  options?: { method?: string; body?: unknown; emptyResponse?: boolean },
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  let res: Response
  try {
    res = await fetch(`${SPOTIFY_API}${path}`, {
      method: options?.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Spotify API ${res.status}: ${text}`)
  }
  if (options?.emptyResponse) return undefined as T
  return (await res.json()) as T
}

async function searchTracks(
  accessToken: string,
  query: string,
): Promise<SpotifyTrackSearchResponse> {
  return spotifyFetch(accessToken, `/v1/search?q=${encodeURIComponent(query)}&type=track&limit=10`)
}

async function resolveTracks(token: string, items: PlaylistItem[]) {
  const trackUris: string[] = []
  let itemsSkipped = 0

  for (const item of items) {
    if (item.spotifyUri) {
      assertValidTrackUri(item.spotifyUri, `for ${item.artistName}`)
      trackUris.push(item.spotifyUri)
      continue
    }

    if (item.trackName) {
      const trackName = item.trackName
      const search = await searchTracks(token, `artist:${item.artistName} track:${trackName}`)
      const match = search.tracks.items.find((track) =>
        isExactTrackMatch(track, item.artistName, trackName),
      )
      if (match) trackUris.push(match.uri)
      else itemsSkipped += 1
      continue
    }

    const search = await searchTracks(token, `artist:${item.artistName}`)
    const artistTracks = search.tracks.items.filter((track) => hasArtist(track, item.artistName))
    if (artistTracks.length === 0) itemsSkipped += 1
    trackUris.push(...artistTracks.slice(0, TRACKS_PER_ARTIST).map((track) => track.uri))
  }

  for (const uri of trackUris) {
    assertValidTrackUri(uri, 'returned by search')
  }

  return { trackUris, itemsSkipped }
}

export function createSpotifyPlaylistTarget(
  targetId: number,
  config: SpotifyPlaylistConfig,
): DestinationTarget {
  function failure(error: unknown, token?: string, playlistId?: string): PlaylistResult {
    return {
      success: false,
      targetType: 'spotify-playlist',
      targetId,
      ...(playlistId ? { playlistId } : {}),
      error: `Spotify playlist export failed: ${redactSpotifyError(error, token)}`,
    }
  }

  async function addTracks(token: string, playlistId: string, uris: string[], replace = false) {
    for (let i = 0; i < uris.length; i += TRACKS_PER_BATCH) {
      await spotifyFetch<SpotifyAddItemsResponse>(
        token,
        `/v1/playlists/${encodeURIComponent(playlistId)}/items`,
        {
          method: replace && i === 0 ? 'PUT' : 'POST',
          body: { uris: uris.slice(i, i + TRACKS_PER_BATCH) },
        },
      )
    }
  }

  async function createPrepared(
    token: string,
    resolved: Awaited<ReturnType<typeof resolveTracks>>,
    name: string,
    onCreated?: (playlistId: string) => Promise<void>,
    options?: { description?: string; public?: boolean },
  ): Promise<PlaylistResult> {
    let playlistId: string | undefined
    try {
      const playlist = await spotifyFetch<SpotifyPlaylistResponse>(token, '/v1/me/playlists', {
        method: 'POST',
        body: {
          name,
          description: options?.description ?? 'Generated by Digarr',
          public: options?.public ?? false,
        },
      })
      if (typeof playlist?.id === 'string' && playlist.id.trim()) {
        playlistId = playlist.id
        await onCreated?.(playlistId)
      }
      if (!playlistId || !hasPlaylistIdentity(playlist)) {
        throw new Error('Spotify did not return a playlist ID and name')
      }
      await addTracks(token, playlistId, resolved.trackUris)
      return {
        success: true,
        targetType: 'spotify-playlist',
        targetId,
        playlistId,
        playlistName: playlist.name,
        itemsAdded: resolved.trackUris.length,
        itemsSkipped: resolved.itemsSkipped,
      }
    } catch (error) {
      return failure(error, token, playlistId)
    }
  }

  return {
    id: `spotify-playlist-${targetId}`,
    name: 'Spotify Playlist',
    type: 'spotify-playlist',
    capabilities: ['createPlaylist'],

    async createPlaylist(name, items, options): Promise<PlaylistResult> {
      let token: string | undefined
      try {
        token = await config.getAccessToken()
        return await createPrepared(
          token,
          await resolveTracks(token, items),
          name,
          undefined,
          options,
        )
      } catch (error) {
        return failure(error, token)
      }
    },

    async openPlaylistExportSession(items) {
      let token: string | undefined
      try {
        token = await config.getAccessToken()
        const accessToken = token
        const me = await spotifyFetch<{ id: string }>(accessToken, '/v1/me')
        const scope = createPlaylistScope('spotify-playlist', [me.id])
        const resolved = await resolveTracks(accessToken, items)
        if (resolved.trackUris.length === 0) throw new Error('No usable Spotify tracks to export')
        return {
          scope,
          createPlaylist: (name, onCreated) =>
            createPrepared(accessToken, resolved, name, onCreated),
          async replacePlaylist(playlistId, name) {
            try {
              const path = `/v1/playlists/${encodeURIComponent(playlistId)}`
              const playlist = await spotifyFetch<{ id: string; owner?: { id?: string } }>(
                accessToken,
                path,
              )
              if (playlist.id !== playlistId || playlist.owner?.id !== me.id) {
                throw new Error('Spotify playlist owner does not match the export account')
              }
              await addTracks(accessToken, playlistId, resolved.trackUris, true)
              await spotifyFetch<void>(accessToken, path, {
                method: 'PUT',
                body: { name },
                emptyResponse: true,
              })
              return {
                success: true,
                targetType: 'spotify-playlist',
                targetId,
                playlistId,
                playlistName: name,
                itemsAdded: resolved.trackUris.length,
                itemsSkipped: resolved.itemsSkipped,
              }
            } catch (error) {
              return failure(error, accessToken, playlistId)
            }
          },
        }
      } catch (error) {
        throw new Error(redactSpotifyError(error, token))
      }
    },

    async testConnection(): Promise<ServiceTestResult> {
      let token: string | undefined
      try {
        token = await config.getAccessToken()
        const me = await spotifyFetch<{ display_name: string }>(token, '/v1/me')
        return {
          success: true,
          message: `Connected as ${me.display_name}`,
        }
      } catch (err: unknown) {
        return {
          success: false,
          message: redactSpotifyError(err, token),
        }
      }
    },
  }
}
