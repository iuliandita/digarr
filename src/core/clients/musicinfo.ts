import { createHttpClient } from './http'
import { extractImages, type ImageResult } from './image-utils'

type SkyHookArtistResponse = {
  images?: Array<{ coverType: string; remoteUrl?: string }>
}

/** Client for musicinfo.pro (or self-hosted hearring-aid). */
export function createMusicinfoClient(baseUrl = 'https://api.musicinfo.pro') {
  const http = createHttpClient({
    baseUrl,
    retries: 1,
    timeout: 8_000,
    publicIpOnly: true,
  })

  return {
    async lookupArtistImages(mbid: string): Promise<ImageResult> {
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
