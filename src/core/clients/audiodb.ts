import { createHttpClient } from './http'
import type { ImageResult } from './image-utils'

export class RateLimitedError extends Error {
  constructor() {
    super('AudioDB rate limit exceeded')
    this.name = 'RateLimitedError'
  }
}

type AudiodbArtist = {
  strArtist?: string
  strArtistThumb?: string | null
  strArtistLogo?: string | null
  strArtistBanner?: string | null
  strArtistFanart?: string | null
}

type AudiodbResponse = {
  artists: AudiodbArtist[] | null
}

export interface AudiodbClientConfig {
  apiKey?: string
  tryConsume: () => Promise<boolean>
  baseUrl?: string
}

const DEFAULT_BASE = 'https://www.theaudiodb.com/api/v1/json'

function pickImages(artist: AudiodbArtist | undefined): ImageResult {
  if (!artist) return {}
  const url = artist.strArtistThumb || artist.strArtistFanart || artist.strArtistBanner || undefined
  const logoUrl = artist.strArtistLogo || undefined
  return { url, logoUrl }
}

export type AudiodbClient = ReturnType<typeof createAudiodbClient>

export function createAudiodbClient(config: AudiodbClientConfig) {
  const apiKey = config.apiKey || '123'
  const rootBase = config.baseUrl ?? DEFAULT_BASE
  const baseUrl = `${rootBase}/${apiKey}`

  const http = createHttpClient({
    baseUrl,
    retries: 1,
    timeout: 8_000,
    publicIpOnly: true,
  })

  async function guardedGet<T>(path: string): Promise<T> {
    const ok = await config.tryConsume()
    if (!ok) throw new RateLimitedError()
    try {
      return await http.get<T>(path)
    } catch (err: unknown) {
      const status = (err as { status?: number } | null)?.status
      if (status === 429) throw new RateLimitedError()
      throw err
    }
  }

  return {
    async getArtistImages(mbid: string): Promise<ImageResult> {
      try {
        const data = await guardedGet<AudiodbResponse>(
          `/artist-mb.php?i=${encodeURIComponent(mbid)}`,
        )
        if (!data.artists || data.artists.length === 0) return {}
        return pickImages(data.artists[0])
      } catch (err) {
        if (err instanceof RateLimitedError) throw err
        return {}
      }
    },

    async searchArtistByName(name: string): Promise<ImageResult> {
      try {
        const data = await guardedGet<AudiodbResponse>(`/search.php?s=${encodeURIComponent(name)}`)
        const matches = data.artists ?? []
        if (matches.length !== 1) return {}
        return pickImages(matches[0])
      } catch (err) {
        if (err instanceof RateLimitedError) throw err
        return {}
      }
    },
  }
}
