import { HttpError, HttpTimeoutError } from '@/core/clients/http'
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
import { type LidarrServerSettings, withResolvedLidarrConnection } from './lidarr-connection'
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
      } catch (error) {
        if (error instanceof HttpError && (error.status === 403 || error.status === 404)) {
          return pathResult(false, 'settings.slskdPathUnavailable')
        }
        return { success: false, message: pathProbeFailure(error) }
      }
    }

    return { success: false, message: `Unknown target type: ${type}` }
  } catch (error) {
    return { success: false, message: redactSecrets(errMsg(error)) }
  }
}

// The route resolves the linked Lidarr itself; dropping that argument here made every linked
// slskd test report a path problem without ever asking Lidarr (#1244).
export function createTargetConnectionTester(
  getSettings: () => Promise<LidarrServerSettings | null | undefined>,
) {
  return async (
    type: string,
    config: TargetConnectionConfig,
    linkedLidarrConfig?: TargetConnectionConfig,
  ): Promise<ServiceTestResult> => {
    const resolved = withResolvedLidarrConnection({ type, config }, await getSettings())
    return testTargetConnection(type, resolved.config as TargetConnectionConfig, linkedLidarrConfig)
  }
}

function linkedLidarrClient(config?: TargetConnectionConfig) {
  if (typeof config?.url !== 'string' || typeof config.apiKey !== 'string') return null
  return createLidarrClient(config.url, config.apiKey, skipTlsVerify(config))
}

// A timeout, auth failure or 5xx says nothing about the path itself, so report what happened
// instead of the generic mount advice. The upstream body is left out; it can echo credentials.
function pathProbeFailure(error: unknown): string {
  if (error instanceof HttpTimeoutError) {
    return `Lidarr did not answer the download folder listing within ${Math.round(error.timeoutMs / 1000)}s. Check the load on Lidarr and the speed of the share.`
  }
  if (error instanceof HttpError) {
    return `Lidarr returned HTTP ${error.status} while listing the download folder.`
  }
  return `Could not check the download folder through Lidarr: ${redactSecrets(errMsg(error))}`
}

function pathResult(success: boolean, messageKey: MessageKey): ServiceTestResult {
  return { success, message: createTranslator('en')(messageKey), details: { messageKey } }
}
