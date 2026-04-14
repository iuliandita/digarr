#!/usr/bin/env bun

/**
 * Validate that every supported locale exports a complete message catalog.
 *
 * Usage: bun scripts/i18n-check.ts
 */

import { fileURLToPath } from 'node:url'
import { SUPPORTED_LOCALES } from '../src/core/i18n/locales'
import { getMessages } from '../src/core/i18n/messages'

const referenceLocale = 'en'
const referenceMessages = getMessages(referenceLocale)
const SAME_AS_SOURCE_ALLOWLIST = new Set([
  'Spotify',
  'Deezer',
  'ListenBrainz',
  'Last.fm',
  'MusicBrainz',
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

export async function main(): Promise<void> {
  let failed = false

  for (const locale of SUPPORTED_LOCALES) {
    const messages = getMessages(locale)
    const { missing, extra, empty, sameAsSource } = findCatalogIssues(referenceMessages, messages)
    const untranslated = locale === referenceLocale ? [] : sameAsSource

    if (
      missing.length === 0 &&
      extra.length === 0 &&
      empty.length === 0 &&
      untranslated.length === 0
    ) {
      continue
    }

    failed = true
    console.error(`Locale ${locale} has catalog issues:`)
    if (missing.length > 0) console.error(`  missing: ${missing.join(', ')}`)
    if (extra.length > 0) console.error(`  extra: ${extra.join(', ')}`)
    if (empty.length > 0) console.error(`  empty: ${empty.join(', ')}`)
    if (untranslated.length > 0) console.error(`  untranslated: ${untranslated.join(', ')}`)
  }

  if (failed) {
    process.exit(1)
  }

  console.log(`Validated ${SUPPORTED_LOCALES.length} locales against ${referenceLocale}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main()
}
