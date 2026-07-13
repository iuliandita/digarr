import { createAudiodbClient } from '@/core/clients/audiodb'
import { createFanartClient } from '@/core/clients/fanart'
import { createLidarrClient } from '@/core/clients/lidarr'
import { createMusicinfoClient } from '@/core/clients/musicinfo'
import { decryptField } from '@/core/crypto'
import type { Preferences } from '@/db/schema'
import type { StoreDb } from './store'

type ArtistImageSettings = {
  lidarrUrl: string | null
  lidarrApiKey: string | null
  skipTlsVerify?: boolean
  audiodbApiKey?: string | null
}

type ArtistImagePreferences = Pick<Preferences, 'fanartApiKey' | 'metadataFallbackUrl'>

export function createArtistImageClients({
  settings,
  preferences,
  tryConsumeRateLimit,
}: {
  settings: ArtistImageSettings
  preferences: ArtistImagePreferences
  tryConsumeRateLimit?: StoreDb['tryConsumeRateLimit']
}) {
  const lidarrClient =
    settings.lidarrUrl && settings.lidarrApiKey
      ? createLidarrClient(settings.lidarrUrl, settings.lidarrApiKey, settings.skipTlsVerify)
      : null

  const audiodbClient = tryConsumeRateLimit
    ? createAudiodbClient({
        apiKey: decryptField(settings.audiodbApiKey ?? null) ?? undefined,
        tryConsume: () =>
          tryConsumeRateLimit('audiodb', {
            capacity: 30,
            refillPerMs: 30 / 60_000,
          }),
      })
    : null

  const fanartApiKey = decryptField(preferences.fanartApiKey) ?? null
  const fanartClient = fanartApiKey ? createFanartClient(fanartApiKey) : null
  const musicinfoClient = preferences.metadataFallbackUrl
    ? createMusicinfoClient(preferences.metadataFallbackUrl)
    : null

  return { audiodbClient, lidarrClient, fanartClient, musicinfoClient }
}
