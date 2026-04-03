import { extractImages } from '@/core/pipeline/resolve'
import { createHttpClient } from './http'

type SkyHookArtistResponse = {
  images?: Array<{ coverType: string; remoteUrl?: string }>
}

export type MusicinfoImageResult = {
  url?: string
  logoUrl?: string
}

/**
 * Client for musicinfo.pro (or self-hosted hearring-aid).
 * Mirrors Lidarr's SkyHook API surface: GET /api/v0.4/artist/{mbid}
 */
export function createMusicinfoClient(baseUrl = 'https://api.musicinfo.pro') {
  const http = createHttpClient({
    baseUrl,
    retries: 1,
    timeout: 8_000,
  })

  return {
    async lookupArtistImages(mbid: string): Promise<MusicinfoImageResult> {
      try {
        const data = await http.get<SkyHookArtistResponse>(`/api/v0.4/artist/${mbid}`)
        if (!data.images?.length) return {}
        return extractImages(data.images)
      } catch {
        return {}
      }
    },
  }
}
