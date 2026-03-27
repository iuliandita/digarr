// FRAGILE: Bandcamp has no API. This scrapes HTML from bandcamp.com/search.
// It WILL break when Bandcamp changes their markup. All errors return empty results.
// Rate limited to 1 request per 2 seconds to avoid getting blocked.
//
// NOTE: This client intentionally uses raw fetch() instead of createHttpClient.
// createHttpClient calls res.json() on every response, but Bandcamp returns HTML.
// Parsing HTML requires res.text(), which is incompatible with the shared client's
// response handling. The auth-free, text/html nature of this scraper makes it a
// poor fit for the JSON-oriented http abstraction.

import PQueue from 'p-queue'
import type { ServiceTestResult } from '@/core/types'

const DEFAULT_BASE_URL = 'https://bandcamp.com'

export type BandcampSearchResult = {
  name: string
  url: string
  genre?: string
  imageUrl?: string
}

// Regexes for HTML scraping. These are fragile by nature.
// Targeting .result-info .heading a (artist name + URL), .itemurl for clean URLs,
// and both legacy and current result-type markers.
const RE_RESULT_BLOCK = /<li class="searchresult[^"]*"[^>]*>([\s\S]*?)<\/li>/g
const RE_HEADING_LINK =
  /<div class="heading"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/
const RE_ITEMURL_LINK =
  /<div class="itemurl"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/
const RE_GENRE = /<div class="genre"[^>]*>([\s\S]*?)<\/div>/
const RE_ITEM_TYPE = /<div class="itemtype"[^>]*>([\s\S]*?)<\/div>/
const RE_IMAGE = /<img[^>]+src="([^"]+)"[^>]*>/
const RE_HTML_TAG = /<[^>]+>/g
const RE_BAND_TYPE_MARKER =
  /itemtype=(?:"|')b(?:"|')|data-search=(?:"|')[\s\S]*?(?:"|&quot;)type(?:"|&quot;)\s*:\s*(?:"|&quot;)b(?:"|&quot;)[\s\S]*?(?:"|')/i

function stripHtml(s: string): string {
  return s.replace(RE_HTML_TAG, '').trim()
}

function normalizeBandcampUrl(rawUrl: string): string {
  const trimmed = stripHtml(rawUrl)
  if (!trimmed) return ''

  try {
    const parsed = new URL(trimmed)
    return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '')
  } catch {
    return trimmed.replace(/\?.*$/, '').replace(/\/+$/, '')
  }
}

function parseSearchResults(html: string, limit: number): BandcampSearchResult[] {
  const results: BandcampSearchResult[] = []

  // Reset lastIndex since RE_RESULT_BLOCK is a module-level regex with /g flag
  RE_RESULT_BLOCK.lastIndex = 0

  // Using for..of over iterator avoids assignment-in-expression lint rule
  for (const match of html.matchAll(RE_RESULT_BLOCK)) {
    if (results.length >= limit) break

    const block = match[1] ?? ''
    const full = match[0]

    const itemTypeMatch = RE_ITEM_TYPE.exec(block)
    const itemType = itemTypeMatch ? stripHtml(itemTypeMatch[1] ?? '').toLowerCase() : ''
    const isArtistResult = itemType === 'artist'

    // Only pick up artist/band results.
    if (!isArtistResult && !RE_BAND_TYPE_MARKER.test(full)) {
      continue
    }

    const headingMatch = RE_HEADING_LINK.exec(block)
    if (!headingMatch) continue

    const itemUrlMatch = RE_ITEMURL_LINK.exec(block)
    const rawUrl = (itemUrlMatch?.[1] ?? itemUrlMatch?.[2] ?? headingMatch[1] ?? '').trim()
    const rawName = stripHtml(headingMatch[2] ?? '')
    const normalizedUrl = normalizeBandcampUrl(rawUrl)
    if (!rawName || !normalizedUrl) continue

    const genreMatch = RE_GENRE.exec(block)
    const genre = genreMatch ? stripHtml(genreMatch[1] ?? '').replace(/^genre:\s*/i, '') : undefined

    const imageMatch = RE_IMAGE.exec(block)
    const imageUrl = imageMatch ? (imageMatch[1] ?? '').trim() : undefined

    results.push({
      name: rawName,
      url: normalizedUrl,
      genre: genre || undefined,
      imageUrl: imageUrl || undefined,
    })
  }

  return results
}

export function createBandcampClient(config?: { baseUrl?: string }) {
  const baseUrl = config?.baseUrl ?? DEFAULT_BASE_URL

  // 1 request per 2 seconds -- Bandcamp will throttle/block higher rates
  const queue = new PQueue({ concurrency: 1, interval: 2000, intervalCap: 1 })

  async function fetchHtml(url: string): Promise<string> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; Digarr/1.0; +https://github.com/iuliandita/digarr)',
          Accept: 'text/html,application/xhtml+xml',
        },
        signal: controller.signal,
      })
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} from ${url}`)
      }
      return res.text()
    } finally {
      clearTimeout(timer)
    }
  }

  async function searchArtists(query: string, limit = 25): Promise<BandcampSearchResult[]> {
    try {
      const params = new URLSearchParams({ q: query, item_type: 'b' })
      const url = `${baseUrl}/search?${params.toString()}`
      const html = await (queue.add(() => fetchHtml(url)) as Promise<string>)
      return parseSearchResults(html, limit)
    } catch {
      // Scraping is fragile -- always return empty on any error
      return []
    }
  }

  async function testConnection(): Promise<ServiceTestResult> {
    try {
      const params = new URLSearchParams({ q: 'test', item_type: 'b' })
      const url = `${baseUrl}/search?${params.toString()}`
      const html = await (queue.add(() => fetchHtml(url)) as Promise<string>)
      // Just check we got HTML back -- don't care about parse results
      if (html.includes('bandcamp') || html.includes('search')) {
        return {
          success: true,
          message: 'Connected to Bandcamp -- HTML scraper responding',
        }
      }
      return { success: false, message: 'Unexpected response from Bandcamp' }
    } catch (err: unknown) {
      return {
        success: false,
        message: err instanceof Error ? err.message : String(err),
      }
    }
  }

  return {
    searchArtists,
    testConnection,
  }
}
