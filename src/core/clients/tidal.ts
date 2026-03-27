// FRAGILE: TIDAL has no official public API. This uses client credentials OAuth2
// against undocumented/semi-public endpoints that may change without notice.
// All errors are caught and return empty results or failure -- do NOT throw here.

import { createHttpClient } from '@/core/clients/http'
import type { ServiceTestResult } from '@/core/types'
import { errMsg } from '@/core/validation'

const DEFAULT_TOKEN_URL = 'https://auth.tidal.com/v1/oauth2/token'
const DEFAULT_SEARCH_BASE_URL = 'https://openapi.tidal.com/v2'

export type TidalSearchResult = {
  id: number
  name: string
  popularity: number
  url: string
  imageUrl?: string
}

type TidalTokenResponse = {
  access_token: string
  token_type: string
  expires_in: number
}

// TIDAL's search response shape is undocumented and subject to change.
// We only extract what we need and ignore the rest.
type TidalArtistItem = {
  id?: string | number
  name?: string
  popularity?: number
  externalLinks?: Array<{ href?: string; meta?: { type?: string } }>
  images?: Array<{ href?: string; meta?: { type?: string } }>
  [key: string]: unknown
}

type TidalSearchResponse = {
  data?: Array<{ attributes?: TidalArtistItem; id?: string | number }>
  [key: string]: unknown
}

type CachedToken = {
  token: string
  expiresAt: number
}

export function createTidalClient(config: {
  clientId: string
  clientSecret: string
  baseUrl?: string
  tokenUrl?: string
}) {
  const searchBaseUrl = config.baseUrl ?? DEFAULT_SEARCH_BASE_URL
  const tokenUrl = config.tokenUrl ?? DEFAULT_TOKEN_URL

  let cachedToken: CachedToken | null = null

  async function getAccessToken(): Promise<string> {
    const now = Date.now()
    if (cachedToken && cachedToken.expiresAt > now + 60_000) {
      return cachedToken.token
    }

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.clientId,
      client_secret: config.clientSecret,
    })

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    try {
      const res = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: controller.signal,
      })

      if (!res.ok) {
        const text = await res.text().catch(() => '(unreadable)')
        throw new Error(`TIDAL auth failed (${res.status}): ${text}`)
      }

      const data = (await res.json()) as TidalTokenResponse
      cachedToken = {
        token: data.access_token,
        expiresAt: now + data.expires_in * 1000,
      }
      return cachedToken.token
    } finally {
      clearTimeout(timer)
    }
  }

  function extractImageUrl(item: TidalArtistItem): string | undefined {
    if (!Array.isArray(item.images)) return undefined
    const img = item.images.find((i) => i.meta?.type === 'ARTIST' || i.meta?.type === 'COVER')
    return img?.href || item.images[0]?.href || undefined
  }

  function extractUrl(item: TidalArtistItem, id: string | number): string {
    if (Array.isArray(item.externalLinks)) {
      const tidalLink = item.externalLinks.find((l) => l.meta?.type === 'TIDAL')
      if (tidalLink?.href) return tidalLink.href
    }
    return `https://tidal.com/artist/${id}`
  }

  async function searchArtists(query: string, limit = 25): Promise<TidalSearchResult[]> {
    try {
      const token = await getAccessToken()
      // Create a fresh http client per search so the Authorization header reflects
      // the current (possibly just-refreshed) token. The token fetch above uses raw
      // fetch because it hits a different base URL (auth.tidal.com) with form-encoded
      // body -- createHttpClient only handles JSON, so the auth endpoint stays as-is.
      const http = createHttpClient({
        baseUrl: searchBaseUrl,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.api+json',
        },
      })

      const encodedQuery = encodeURIComponent(query)
      const params = new URLSearchParams({ limit: String(limit) })
      const data = await http.get<TidalSearchResponse>(
        `/searchresults/${encodedQuery}/relationships/artists?${params}`,
      )
      const items = data.data ?? []

      return items.flatMap((entry) => {
        const attrs = entry.attributes ?? {}
        const id = entry.id ?? attrs.id
        if (!id || !attrs.name) return []
        return [
          {
            id: Number(id),
            name: String(attrs.name),
            popularity: Number(attrs.popularity ?? 0),
            url: extractUrl(attrs, id),
            imageUrl: extractImageUrl(attrs),
          },
        ]
      })
    } catch {
      // TIDAL API is fragile -- swallow all errors and return empty
      return []
    }
  }

  async function testConnection(): Promise<ServiceTestResult> {
    try {
      await getAccessToken()
      const results = await searchArtists('test', 1)
      return {
        success: true,
        message: `Connected to TIDAL -- API responding`,
        details: { resultCount: results.length },
      }
    } catch (err: unknown) {
      return { success: false, message: errMsg(err) }
    }
  }

  return {
    searchArtists,
    testConnection,
  }
}
