import { createHttpClient } from './http'
import type { ImageResult } from './image-utils'

type FanartResponse = {
  artistthumb?: Array<{ url: string; likes: string }>
  artistbackground?: Array<{ url: string; likes: string }>
  hdmusiclogo?: Array<{ url: string; likes: string }>
  musiclogo?: Array<{ url: string; likes: string }>
}

export function createFanartClient(apiKey: string, baseUrl = 'https://webservice.fanart.tv/v3') {
  const http = createHttpClient({
    baseUrl,
    headers: { 'api-key': apiKey },
    retries: 1,
    timeout: 8_000,
    publicIpOnly: true,
  })

  return {
    async getArtistImages(mbid: string): Promise<ImageResult> {
      try {
        const data = await http.get<FanartResponse>(`/music/${mbid}`)
        const thumb = data.artistthumb?.[0]?.url
        const bg = data.artistbackground?.[0]?.url
        const url = thumb ?? bg
        const hdLogo = data.hdmusiclogo?.[0]?.url
        const logo = data.musiclogo?.[0]?.url
        const logoUrl = hdLogo ?? logo
        return { url, logoUrl }
      } catch {
        return {}
      }
    },
  }
}
