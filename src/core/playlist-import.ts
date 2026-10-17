import { parseCsvArtists } from '@/core/subscriptions/adapters/csv-import'

export type PlaylistFormat = 'csv' | 'm3u' | 'xspf'

export type PlaylistImportResult = {
  artists: string[]
  unreadable: number
}

export class PlaylistFormatError extends Error {}

const XML_ENTITIES = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
])

export function playlistFormatFor(filename: string): PlaylistFormat {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.m3u') || lower.endsWith('.m3u8')) return 'm3u'
  if (lower.endsWith('.xspf')) return 'xspf'
  return 'csv'
}

export function parsePlaylistFile(
  text: string,
  format: PlaylistFormat,
  maxArtists: number,
): PlaylistImportResult {
  if (format === 'csv') {
    return { artists: parseCsvArtists(text, maxArtists), unreadable: 0 }
  }
  const entries = format === 'm3u' ? parseM3uEntries(text) : parseXspfEntries(text)
  return summarize(entries, maxArtists)
}

// null marks an entry whose artist could not be determined.
function summarize(entries: (string | null)[], maxArtists: number): PlaylistImportResult {
  const seen = new Set<string>()
  const artists: string[] = []
  let unreadable = 0
  for (const name of entries) {
    if (name === null) {
      unreadable++
      continue
    }
    const key = name.toLowerCase()
    if (seen.has(key) || artists.length >= maxArtists) continue
    seen.add(key)
    artists.push(name)
  }
  return { artists, unreadable }
}

function parseM3uEntries(text: string): (string | null)[] {
  const entries: (string | null)[] = []
  let pending: string | null | undefined
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('#EXTINF:')) {
      pending = artistFromExtinf(line.slice('#EXTINF:'.length))
      continue
    }
    if (line.startsWith('#')) continue
    entries.push(pending ?? artistFromPath(line))
    pending = undefined
  }
  return entries
}

function artistFromExtinf(body: string): string | null {
  const comma = body.indexOf(',')
  if (comma === -1) return null
  const display = body.slice(comma + 1).trim()
  const sep = display.indexOf(' - ')
  if (sep <= 0) return null
  return display.slice(0, sep).trim() || null
}

const TRACK_NUMBER_TITLE = /^\d{1,3} - .+$/

// Only unambiguous layouts: Artist/Album/NN - Title.ext, or a flat Artist - Title.ext
// with exactly one separator. Anything else is left unread rather than guessed.
export function artistFromPath(entry: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(entry)) return null
  const parts = entry.split(/[\\/]+/).filter((p) => p && p !== '.' && p !== '..')
  const last = parts.at(-1)
  if (last === undefined) return null
  const file = last.replace(/\.[A-Za-z0-9]{1,5}$/, '')

  if (parts.length >= 3 && TRACK_NUMBER_TITLE.test(file)) {
    return parts.at(-3) ?? null
  }

  const [head = '', ...tail] = file.split(' - ')
  if (tail.length !== 1) return null
  const artist = head.trim()
  if (!artist || /^\d+$/.test(artist)) return null
  return artist
}

function parseXspfEntries(text: string): (string | null)[] {
  const body = text.replace(/^\uFEFF/, '')
  if (/<!DOCTYPE|<!ENTITY/i.test(body)) {
    throw new PlaylistFormatError('Invalid XSPF file')
  }
  const hasPlaylist = /<playlist[\s>]/.test(body) && /<\/playlist\s*>/.test(body)
  const opens = body.match(/<track[\s>]/g)?.length ?? 0
  const closes = body.match(/<\/track\s*>/g)?.length ?? 0
  if (!hasPlaylist || opens !== closes) {
    throw new PlaylistFormatError('Invalid XSPF file')
  }

  return [...body.matchAll(/<track\b[^>]*>([\s\S]*?)<\/track\s*>/g)].map((track) => {
    const creator = /<creator\b[^>]*>([\s\S]*?)<\/creator\s*>/.exec(track[1] ?? '')
    if (!creator) return null
    return xmlText(creator[1] ?? '').trim() || null
  })
}

function xmlText(raw: string): string {
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(raw)
  if (cdata) return cdata[1] ?? ''
  return raw.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, ent: string) => {
    if (ent.startsWith('#')) {
      const hex = ent[1] === 'x' || ent[1] === 'X'
      const codePoint = hex ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10)
      return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match
    }
    return XML_ENTITIES.get(ent.toLowerCase()) ?? match
  })
}
