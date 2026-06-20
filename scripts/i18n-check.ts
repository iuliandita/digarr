#!/usr/bin/env bun

/**
 * Validate that every supported locale exports a complete message catalog.
 *
 * Usage: bun scripts/i18n-check.ts
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SUPPORTED_LOCALES } from '../src/core/i18n/locales'
import { getMessages } from '../src/core/i18n/messages'

// Markers that indicate stripped diacritics in de/es catalogs. CI fails on
// any match so we cannot regress to ASCII-substituted spellings.
const ASCII_MARKERS: Record<string, RegExp> = {
  de: /\b(Zurueck|Taeglich|Laedt|Hoerverlauf|Durchlaeufe|Kuenstler|Aehnliche|Veroeffentlichungen|Wochentliche)\b/,
  es: /\b(Configuracion|Ultima|automatica|busqueda|suscripcion|Genero|puntuacion)\b/,
}

// Key prefixes accessed via template literals in app code. Treat as
// referenced so the orphan check doesn't flag every mode/stage key.
const DYNAMIC_PREFIXES = [
  'discoveryMode.',
  'pipeline.stage.',
  'pipeline.description.',
  'artist.externalLinks.',
  'libraryHealth.',
  'rejectionReason.',
]

const referenceLocale = 'en'
const referenceMessages = getMessages(referenceLocale)
const SAME_AS_SOURCE_ALLOWLIST = new Set([
  // "Volume" is the standard audio term and identical in fr/it/nl/pt-BR.
  'Volume',
  'Spotify',
  'Deezer',
  'ListenBrainz',
  'Last.fm',
  'MusicBrainz',
  'TheAudioDB',
  'Wikidata',
  'Wikipedia',
  'Lidarr',
  'Jellyfin',
  'Emby',
  'Plex',
  'Navidrome',
  'Discogs',
  'OpenAI',
  'OpenAI-Compatible',
  'OpenAI-compatible',
  'Google Gemini',
  'Anthropic',
  'Ollama',
  'Ollama (local)',
  'Groq',
  'OpenRouter',
  'LiteLLM',
  'LocalAI',
  'Discord',
  'Slack',
  'Gotify',
  'ntfy',
  'JSON',
  'CSV',
  'M3U',
  'XSPF',
  'MBID',
  'UUID',
  'URL',
  'API',
  'API Key',
  'N/A',
  'spotify',
  'deezer',
  'musicbrainz',
  'local',
  'slskd',
  'OIDC',
  'SSO',
  'OIDC / SSO',
  'HTTP',
  'Digarr',
  'shoegaze',
  'Radiohead, Portishead, Massive Attack',
  'Weekly Jams',
  'PLAY',
  'STOP',
])

function shouldFlagSameAsSource(value: string): boolean {
  if (!/[A-Za-z]/.test(value)) return false
  return !SAME_AS_SOURCE_ALLOWLIST.has(value)
}

export function findCatalogIssues(
  sourceCatalog: Record<string, string>,
  translatedCatalog: Record<string, string>,
) {
  const sourceKeys = Object.keys(sourceCatalog)
  const translatedKeys = Object.keys(translatedCatalog)
  const missing = sourceKeys.filter((key) => !(key in translatedCatalog))
  const extra = translatedKeys.filter((key) => !sourceKeys.includes(key))
  const empty = sourceKeys.filter((key) => translatedCatalog[key]?.trim() === '')
  const sameAsSource = sourceKeys.filter((key) => {
    const sourceValue = sourceCatalog[key]
    const translatedValue = translatedCatalog[key]
    if (!sourceValue || !translatedValue) return false
    if (sourceValue !== translatedValue) return false
    return shouldFlagSameAsSource(sourceValue)
  })

  return { missing, extra, empty, sameAsSource }
}

function findAsciiMarkers(locale: string, messages: Record<string, string>): string[] {
  const regex = ASCII_MARKERS[locale]
  if (!regex) return []
  const hits: string[] = []
  for (const [key, value] of Object.entries(messages)) {
    if (typeof value === 'string' && regex.test(value)) {
      hits.push(`${key}: "${value}"`)
    }
  }
  return hits
}

function collectSourceFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      if (full.endsWith('/i18n/messages')) continue
      collectSourceFiles(full, out)
    } else if (full.endsWith('.ts') || full.endsWith('.tsx')) {
      out.push(full)
    }
  }
}

async function findOrphanedKeys(referenceKeys: string[]): Promise<string[]> {
  const files: string[] = []
  collectSourceFiles('src', files)
  const body = files.map((f) => readFileSync(f, 'utf8')).join('\n')

  const confirmedDynamic = DYNAMIC_PREFIXES.filter((prefix) => {
    const escaped = prefix.replace(/\./g, '\\.')
    return new RegExp(`\\b${escaped}\\$\\{`).test(body)
  })

  return referenceKeys.filter((key) => {
    if (body.includes(key)) return false
    for (const prefix of confirmedDynamic) {
      if (key.startsWith(prefix)) return false
    }
    return true
  })
}

export async function main(): Promise<void> {
  let failed = false

  for (const locale of SUPPORTED_LOCALES) {
    const messages = getMessages(locale)
    const { missing, extra, empty, sameAsSource } = findCatalogIssues(referenceMessages, messages)
    const untranslated = locale === referenceLocale ? [] : sameAsSource
    const asciiHits = findAsciiMarkers(locale, messages)

    if (
      missing.length === 0 &&
      extra.length === 0 &&
      empty.length === 0 &&
      untranslated.length === 0 &&
      asciiHits.length === 0
    ) {
      continue
    }

    failed = true
    console.error(`Locale ${locale} has catalog issues:`)
    if (missing.length > 0) console.error(`  missing: ${missing.join(', ')}`)
    if (extra.length > 0) console.error(`  extra: ${extra.join(', ')}`)
    if (empty.length > 0) console.error(`  empty: ${empty.join(', ')}`)
    if (untranslated.length > 0) console.error(`  untranslated: ${untranslated.join(', ')}`)
    if (asciiHits.length > 0) console.error(`  ascii-stripped: ${asciiHits.join('; ')}`)
  }

  const orphans = await findOrphanedKeys(Object.keys(referenceMessages))
  if (orphans.length > 0) {
    failed = true
    console.error(`Orphaned keys (in en.ts, not referenced in src/):`)
    for (const key of orphans) console.error(`  - ${key}`)
  }

  if (failed) {
    process.exit(1)
  }

  console.log(
    `Validated ${SUPPORTED_LOCALES.length} locales against ${referenceLocale}; no orphans or ASCII markers.`,
  )
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main()
}
