import { createJellyfinClient } from '@/core/clients/jellyfin'
import { createSlskdClient } from '@/core/clients/slskd'
import type { ServiceTestResult } from '@/core/types'
import { errMsg, redactSecrets } from '@/core/validation'
import { createEmbyPlaylistTarget } from './emby-playlist'
import { createJellyfinPlaylistTarget } from './jellyfin-playlist'
import { createLidarrTarget } from './lidarr'
import { createNavidromePlaylistTarget } from './navidrome-playlist'
import { createPlexPlaylistTarget } from './plex-playlist'

type TargetConnectionConfig = Record<string, unknown>

function skipTlsVerify(config: TargetConnectionConfig): boolean {
  return (config.skipTlsVerify as boolean) ?? false
}

export async function testTargetConnection(
  type: string,
  config: TargetConnectionConfig,
): Promise<ServiceTestResult> {
  try {
    if (type === 'lidarr') {
      return createLidarrTarget(0, {
        url: config.url as string,
        apiKey: config.apiKey as string,
        skipTlsVerify: skipTlsVerify(config),
      }).testConnection()
    }

    if (type === 'jellyfin') {
      return createJellyfinClient(
        config.url as string,
        config.apiKey as string,
        (config.userId as string) ?? '',
        { skipTlsVerify: skipTlsVerify(config) },
      ).testConnection()
    }

    if (type === 'emby-playlist') {
      return createEmbyPlaylistTarget(0, {
        url: config.url as string,
        apiKey: config.apiKey as string,
        userId: config.userId as string,
        skipTlsVerify: skipTlsVerify(config),
      }).testConnection()
    }

    if (type === 'jellyfin-playlist') {
      return createJellyfinPlaylistTarget(0, {
        url: config.url as string,
        apiKey: config.apiKey as string,
        userId: config.userId as string,
        skipTlsVerify: skipTlsVerify(config),
      }).testConnection()
    }

    if (type === 'plex-playlist') {
      return createPlexPlaylistTarget(0, {
        url: config.url as string,
        token: config.token as string,
      }).testConnection()
    }

    if (type === 'navidrome-playlist') {
      return createNavidromePlaylistTarget(0, {
        url: config.url as string,
        username: config.username as string,
        password: config.password as string,
      }).testConnection()
    }

    if (type === 'spotify-playlist') {
      return {
        success: false,
        message:
          'Spotify targets require OAuth connection. Use Settings > Connections to connect Spotify first.',
      }
    }

    if (type === 'slskd') {
      return createSlskdClient(
        config.url as string,
        config.apiKey as string,
        skipTlsVerify(config),
      ).testConnection()
    }

    return { success: false, message: `Unknown target type: ${type}` }
  } catch (error) {
    return { success: false, message: redactSecrets(errMsg(error)) }
  }
}
