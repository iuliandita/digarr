#!/usr/bin/env bun

/**
 * Generate a translated message catalog through an OpenAI-compatible endpoint.
 *
 * Usage:
 *   bun scripts/i18n-machine-translate.ts <locale> [--write]
 *
 * Defaults to a dry run that prints the translated catalog as formatted JSON.
 * Pass --write to update the locale file in src/core/i18n/messages/.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SUPPORTED_LOCALES } from '../src/core/i18n/locales'
import { getMessages } from '../src/core/i18n/messages'

const args = process.argv.slice(2)
const targetLocale = args.find((arg) => !arg.startsWith('-'))
const writeOutput = args.includes('--write')
const sourceLocale = 'en'

const baseUrl = process.env.TRANSLATION_BASE_URL?.trim() || undefined
const apiKey = process.env.TRANSLATION_API_KEY?.trim() || undefined
const model = process.env.TRANSLATION_MODEL?.trim() || 'gpt-4o-mini'

const PLACEHOLDER_PATTERN = /\$\{[^}]+\}|\{\{[^}]+\}\}|\{[A-Za-z0-9_]+\}|%[sdif]/g
const LINE_BREAK_PATTERN = /\r\n|\n|\r/g
const PROTECTED_TERMS = [
  'Google Gemini',
  'OpenRouter',
  'LiteLLM',
  'LocalAI',
  'MusicBrainz',
  'ListenBrainz',
  'Last.fm',
  'Anthropic',
  'OpenAI',
  'Lidarr',
  'Jellyfin',
  'Navidrome',
  'Spotify',
  'Discord',
  'Deezer',
  'Digarr',
  'Groq',
  'Ollama',
  'Emby',
  'Plex',
] as const

const sourceMessages = getMessages(sourceLocale)
const expectedKeys = Object.keys(sourceMessages)
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const outputPath = path.resolve(scriptDir, `../src/core/i18n/messages/${targetLocale}.ts`)

function toExportName(locale: string): string {
  return locale.replace(/[^a-zA-Z0-9]/g, '')
}

function extractJson(text: string): string {
  const trimmed = text.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed

  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1)
  }

  throw new Error('Model response did not include a JSON object')
}

function renderTypeScriptCatalog(locale: string, catalog: Record<string, string>): string {
  const exportName = toExportName(locale)
  const entries = expectedKeys.map(
    (key) => `  ${JSON.stringify(key)}: ${JSON.stringify(catalog[key])},`,
  )
  return [`export const ${exportName} = {`, ...entries, '} as const', ''].join('\n')
}

export function buildChatCompletionsUrl(baseUrlValue: string): string {
  const normalized = baseUrlValue.replace(/\/+$/, '')
  const suffix = normalized.endsWith('/v1') ? '/chat/completions' : '/v1/chat/completions'
  return `${normalized}${suffix}`
}

function countExactMatches(value: string, term: string): number {
  if (!value.includes(term)) return 0

  let count = 0
  let offset = 0
  while (true) {
    const index = value.indexOf(term, offset)
    if (index === -1) break
    count++
    offset = index + term.length
  }
  return count
}

function listMatches(value: string, pattern: RegExp): string[] {
  return value.match(pattern) ?? []
}

export function buildTranslationMessages(
  sourceLocaleValue: string,
  targetLocaleValue: string,
  catalog: Record<string, string>,
) {
  return [
    {
      role: 'system' as const,
      content:
        'Translate the provided JSON object into the target language. Return JSON only, with the exact same keys, no markdown, no commentary, and preserve placeholders, punctuation, line breaks, artist names, and product names exactly.',
    },
    {
      role: 'user' as const,
      content: [
        `Source locale: ${sourceLocaleValue}`,
        `Target locale: ${targetLocaleValue}`,
        'Translate this catalog:',
        JSON.stringify(catalog, null, 2),
      ].join('\n\n'),
    },
  ]
}

export function validateTranslatedCatalog(
  sourceCatalog: Record<string, string>,
  translatedCatalog: Record<string, string>,
): void {
  const errors: string[] = []

  for (const key of Object.keys(sourceCatalog)) {
    const sourceValue = sourceCatalog[key]
    const translatedValue = translatedCatalog[key]
    if (sourceValue === undefined || translatedValue === undefined) continue

    const sourcePlaceholders = listMatches(sourceValue, PLACEHOLDER_PATTERN)
    const translatedPlaceholders = listMatches(translatedValue, PLACEHOLDER_PATTERN)
    if (
      [...sourcePlaceholders].sort().join('\u0000') !==
      [...translatedPlaceholders].sort().join('\u0000')
    ) {
      errors.push(
        `${key}: placeholder mismatch (${sourcePlaceholders.join(', ') || 'none'} vs ${translatedPlaceholders.join(', ') || 'none'})`,
      )
    }

    const sourceLineBreaks = listMatches(sourceValue, LINE_BREAK_PATTERN)
    const translatedLineBreaks = listMatches(translatedValue, LINE_BREAK_PATTERN)
    if (sourceLineBreaks.join('\u0000') !== translatedLineBreaks.join('\u0000')) {
      errors.push(`${key}: line break mismatch`)
    }

    for (const term of PROTECTED_TERMS) {
      const sourceCount = countExactMatches(sourceValue, term)
      if (sourceCount === 0) continue
      const translatedCount = countExactMatches(translatedValue, term)
      if (translatedCount !== sourceCount) {
        errors.push(`${key}: protected term mismatch for ${term}`)
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Translated catalog failed validation (${errors.join('; ')})`)
  }
}

async function translateCatalog({
  baseUrl,
  model,
  targetLocale,
}: {
  baseUrl: string
  model: string
  targetLocale: string
}): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  const messages = buildTranslationMessages(sourceLocale, targetLocale, sourceMessages)

  const res = await fetch(buildChatCompletionsUrl(baseUrl), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
      max_completion_tokens: 4096,
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Translation request failed: ${res.status} ${body}`)
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = data.choices?.[0]?.message?.content
  if (!content) {
    throw new Error('Translation response was empty')
  }

  const parsed = JSON.parse(extractJson(content)) as Record<string, unknown>
  const catalog: Record<string, string> = {}
  const missing: string[] = []
  const invalid: string[] = []

  for (const key of expectedKeys) {
    const value = parsed[key]
    if (typeof value !== 'string') {
      if (value === undefined) missing.push(key)
      else invalid.push(key)
      continue
    }
    catalog[key] = value
  }

  const extra = Object.keys(parsed).filter((key) => !expectedKeys.includes(key))
  if (missing.length > 0 || invalid.length > 0 || extra.length > 0) {
    const parts: string[] = []
    if (missing.length > 0) parts.push(`missing: ${missing.join(', ')}`)
    if (invalid.length > 0) parts.push(`non-string: ${invalid.join(', ')}`)
    if (extra.length > 0) parts.push(`extra: ${extra.join(', ')}`)
    throw new Error(`Translated catalog failed validation (${parts.join('; ')})`)
  }

  validateTranslatedCatalog(sourceMessages, catalog)

  return catalog
}

export async function main(): Promise<void> {
  if (!targetLocale) {
    console.error('Usage: bun scripts/i18n-machine-translate.ts <locale> [--write]')
    process.exit(1)
  }

  if (!SUPPORTED_LOCALES.includes(targetLocale as (typeof SUPPORTED_LOCALES)[number])) {
    console.error(`Unsupported locale: ${targetLocale}`)
    process.exit(1)
  }

  if (targetLocale === sourceLocale) {
    console.error('Target locale must differ from the source locale')
    process.exit(1)
  }

  if (!baseUrl) {
    console.error('TRANSLATION_BASE_URL must be set for translation generation')
    process.exit(1)
  }

  if (!model) {
    console.error('TRANSLATION_MODEL must be set for translation generation')
    process.exit(1)
  }

  const translatedCatalog = await translateCatalog({ baseUrl, model, targetLocale })

  if (!writeOutput) {
    console.log(JSON.stringify(translatedCatalog, null, 2))
    return
  }

  await mkdir(path.dirname(outputPath), { recursive: true })
  const currentFile = await readFile(outputPath, 'utf8').catch(() => '')
  const nextFile = renderTypeScriptCatalog(targetLocale, translatedCatalog)

  if (currentFile === nextFile) {
    console.log(`No changes for ${targetLocale}`)
    return
  }

  await writeFile(outputPath, nextFile)
  console.log(`Wrote ${outputPath}`)
}

if (import.meta.main) {
  await main()
}
