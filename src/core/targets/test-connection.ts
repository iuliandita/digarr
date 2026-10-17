import { createJellyfinClient } from '@/core/clients/jellyfin'
import { createLidarrClient } from '@/core/clients/lidarr'
import { createSlskdClient } from '@/core/clients/slskd'
import type { MessageKey } from '@/core/i18n/messages/types'
import { createTranslator } from '@/core/i18n/translator'
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
  linkedLidarrConfig?: TargetConnectionConfig,
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
      const result = await createSlskdClient(
        config.url as string,
        config.apiKey as string,
        skipTlsVerify(config),
      ).testConnection()
      if (!result.success || config.lidarrTargetId == null || !config.lidarrDownloadPath)
        return result
      const path = String(config.lidarrDownloadPath)
      if (/(^|[\\/])(?:incomplete|incompleted|in-progress|in_progress)([\\/]|$)/i.test(path)) {
        return pathResult(false, 'settings.slskdPathIncomplete')
      }
      try {
        const lidarr = linkedLidarrClient(linkedLidarrConfig)
        if (!lidarr || !(await lidarr.canListPath(path)))
          return pathResult(false, 'settings.slskdPathUnavailable')
        return pathResult(true, 'settings.slskdPathOk')
      } catch {
        return pathResult(false, 'settings.slskdPathUnavailable')
      }
    }

    return { success: false, message: `Unknown target type: ${type}` }
  } catch (error) {
    return { success: false, message: redactSecrets(errMsg(error)) }
  }
}

function linkedLidarrClient(config?: TargetConnectionConfig) {
  if (typeof config?.url !== 'string' || typeof config.apiKey !== 'string') return null
  return createLidarrClient(config.url, config.apiKey, skipTlsVerify(config))
}

function pathResult(success: boolean, messageKey: MessageKey): ServiceTestResult {
  return { success, message: createTranslator('en')(messageKey), details: { messageKey } }
}
