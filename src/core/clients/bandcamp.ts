// FRAGILE: Bandcamp has no API. This scrapes HTML from bandcamp.com/search.
// It WILL break when Bandcamp changes their markup. All errors return empty results.
// Rate limited to 1 request per 2 seconds to avoid getting blocked.
//
// NOTE: This client intentionally uses raw fetch() instead of createHttpClient.
// createHttpClient calls res.json() on every response, but Bandcamp returns HTML.
// Parsing HTML requires res.text(), which is incompatible with the shared client's
// response handling. The auth-free, text/html nature of this scraper makes it a
// poor fit for the JSON-oriented http abstraction.

import dns from 'node:dns/promises'
import PQueue from 'p-queue'
import type { ServiceTestResult } from '@/core/types'
import { getLookupHostname, isPrivateIp, isPrivateUrl } from '@/core/validation'

const DEFAULT_BASE_URL = 'https://bandcamp.com'
const MAX_BODY_BYTES = 2 * 1024 * 1024
const MAX_REDIRECTS = 3

async function assertPublicUrl(url: string): Promise<void> {
  if (isPrivateUrl(url)) throw new Error('URL points to a private/internal address')
  const { address } = await dns.lookup(getLookupHostname(url))
  if (isPrivateIp(address)) throw new Error('URL resolves to a private/internal IP')
}

async function readCapped(res: Response): Promise<string> {
  if (!res.body) return ''
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let received = 0
  let out = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    if (received > MAX_BODY_BYTES) {
      await reader.cancel()
      throw new Error('Bandcamp response too large')
    }
    out += decoder.decode(value, { stream: true })
  }
  return out + decoder.decode()
}

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
const RE_BAND_TYPE_MARKER =
  /itemtype=(?:"|')b(?:"|')|data-search=(?:"|')[\s\S]*?(?:"|&quot;)type(?:"|&quot;)\s*:\s*(?:"|&quot;)b(?:"|&quot;)[\s\S]*?(?:"|')/i

const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  quot: '"',
  '#39': "'",
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (entity, code: string) => {
    const named = HTML_ENTITIES[code.toLowerCase()]
    if (named) return named
    if (code.startsWith('#x')) {
      const parsed = Number.parseInt(code.slice(2), 16)
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : entity
    }
    if (code.startsWith('#')) {
      const parsed = Number.parseInt(code.slice(1), 10)
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : entity
    }
    return entity
  })
}

function removeHtmlTags(value: string): string {
  let result = ''
  let inTag = false

  for (const char of value) {
    if (char === '<') {
      inTag = true
      continue
    }

    if (char === '>') {
      if (inTag) {
        inTag = false
        continue
      }
      continue
    }

    if (!inTag) {
      result += char
    }
  }

  return result
}

function stripHtml(s: string): string {
  let current = s
  let previous: string

  do {
    previous = current
    current = removeHtmlTags(decodeHtmlEntities(current))
  } while (current !== previous)

  return current.trim()
}

function normalizeBandcampUrl(rawUrl: string): string {
  const trimmed = stripHtml(rawUrl)
  if (!trimmed) return ''

  try {
    const parsed = new URL(trimmed, DEFAULT_BASE_URL)
    if (!['http:', 'https:'].includes(parsed.protocol)) return ''
    return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '')
  } catch {
    return ''
  }
}

function normalizeImageUrl(rawUrl: string): string {
  const trimmed = stripHtml(rawUrl)
  if (!trimmed) return ''
  try {
    const parsed = new URL(trimmed, DEFAULT_BASE_URL)
    if (!['http:', 'https:'].includes(parsed.protocol)) return ''
    return parsed.href
  } catch {
    return ''
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
    const imageUrl = imageMatch ? normalizeImageUrl(imageMatch[1] ?? '') : undefined

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

  // 1 request per 2 seconds - Bandcamp will throttle/block higher rates
  const queue = new PQueue({ concurrency: 1, interval: 2000, intervalCap: 1 })

  // The SSRF guard only applies to the real host; a custom baseUrl is a test/dev override.
  const guard = baseUrl === DEFAULT_BASE_URL

  async function fetchHtml(startUrl: string): Promise<string> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    try {
      let url = startUrl
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        if (guard) await assertPublicUrl(url)
        const res = await fetch(url, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (compatible; Digarr/1.0; +https://github.com/iuliandita/digarr)',
            Accept: 'text/html,application/xhtml+xml',
          },
          redirect: guard ? 'manual' : 'follow',
          signal: controller.signal,
        })
        const location = res.headers.get('location')
        if (guard && res.status >= 300 && res.status < 400 && location) {
          url = new URL(location, url).toString()
          continue
        }
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} from ${url}`)
        }
        // Read inside the timer so a stalled body is aborted too.
        return await readCapped(res)
      }
      throw new Error('Too many redirects from Bandcamp')
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
      // Scraping is fragile - always return empty on any error
      return []
    }
  }

  async function testConnection(): Promise<ServiceTestResult> {
    try {
      const params = new URLSearchParams({ q: 'test', item_type: 'b' })
      const url = `${baseUrl}/search?${params.toString()}`
      const html = await (queue.add(() => fetchHtml(url)) as Promise<string>)
      // Just check we got HTML back - don't care about parse results
      if (html.includes('bandcamp') || html.includes('search')) {
        return {
          success: true,
          message: 'Connected to Bandcamp - HTML scraper responding',
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
