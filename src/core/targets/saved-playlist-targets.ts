import { createEmbyPlaylistTarget } from './emby-playlist'
import { createJellyfinPlaylistTarget } from './jellyfin-playlist'
import { createNavidromePlaylistTarget } from './navidrome-playlist'
import { createPlexPlaylistTarget } from './plex-playlist'
import { createSpotifyPlaylistTarget } from './spotify-playlist'
import type { DestinationTarget } from './types'

export type SavedPlaylistTargetRow = {
  id: number
  type: string
  config: Record<string, unknown>
}

export type SavedPlaylistTargetOptions = {
  globalSkipTlsVerify: boolean
  getSpotifyAccessToken: () => Promise<string>
}

/** Builds the destination for a saved-playlist export, or null when the type cannot refresh playlists. */
export function createSavedPlaylistExportTarget(
  row: SavedPlaylistTargetRow,
  options: SavedPlaylistTargetOptions,
): DestinationTarget | null {
  const { config } = row
  const skipTlsVerify = (config.skipTlsVerify as boolean | undefined) ?? options.globalSkipTlsVerify
  let target: DestinationTarget | null = null

  if (row.type === 'navidrome-playlist') {
    target = createNavidromePlaylistTarget(row.id, {
      url: config.url as string,
      username: config.username as string,
      password: config.password as string,
    })
  } else if (row.type === 'jellyfin-playlist') {
    target = createJellyfinPlaylistTarget(row.id, {
      url: config.url as string,
      apiKey: config.apiKey as string,
      userId: config.userId as string,
      skipTlsVerify,
    })
  } else if (row.type === 'emby-playlist') {
    target = createEmbyPlaylistTarget(row.id, {
      url: config.url as string,
      apiKey: config.apiKey as string,
      userId: config.userId as string,
      skipTlsVerify,
    })
  } else if (row.type === 'plex-playlist') {
    target = createPlexPlaylistTarget(row.id, {
      url: config.url as string,
      token: config.token as string,
    })
  } else if (row.type === 'spotify-playlist') {
    target = createSpotifyPlaylistTarget(row.id, {
      getAccessToken: options.getSpotifyAccessToken,
    })
  }

  return target?.openPlaylistExportSession ? target : null
}
