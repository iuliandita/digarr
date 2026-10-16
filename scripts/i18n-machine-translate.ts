#!/usr/bin/env bun

/**
 * Generate a translated message catalog through an OpenAI-compatible endpoint.
 *
 * Usage:
 *   bun scripts/i18n-machine-translate.ts <locale> [--write]
 *   bun scripts/i18n-machine-translate.ts --stale [<locale>...] [--write]
 *
 * Defaults to a dry run that prints the translated catalog as formatted JSON.
 * Pass --write to update the locale file in src/core/i18n/messages/.
 * --stale translates only keys whose English differs from source-lock.json,
 * in every locale (or the ones named), and edits just those entries. Review
 * the result, then run `bun run i18n:stamp`.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SUPPORTED_LOCALES } from '../src/core/i18n/locales'
import { getMessages, getRawMessages } from '../src/core/i18n/messages'
import { PROTECTED_I18N_TERMS } from '../src/core/i18n/protected-terms'
import { findSourceLockDrift, readSourceLock } from './i18n-source-lock'

const args = process.argv.slice(2)
const targetLocale = args.find((arg) => !arg.startsWith('-'))
const writeOutput = args.includes('--write')
const staleOnly = args.includes('--stale')
const sourceLocale = 'en'

const baseUrl = process.env.TRANSLATION_BASE_URL?.trim() || undefined
const apiKey = process.env.TRANSLATION_API_KEY?.trim() || undefined
const model = process.env.TRANSLATION_MODEL?.trim() || 'gpt-4o-mini'

const PLACEHOLDER_PATTERN = /\$\{[^}]+\}|\{\{[^}]+\}\}|\{[A-Za-z0-9_]+\}|%[sdif]/g
const LINE_BREAK_PATTERN = /\r\n|\n|\r/g
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
  previous: Record<string, string> = {},
) {
  const user = [
    `Source locale: ${sourceLocaleValue}`,
    `Target locale: ${targetLocaleValue}`,
    'Translate this catalog:',
    JSON.stringify(catalog, null, 2),
  ]
  if (Object.keys(previous).length > 0) {
    user.push(
      'These keys were translated before the English changed. Update them to match the new English and keep their terminology:',
      JSON.stringify(previous, null, 2),
    )
  }
  return [
    {
      role: 'system' as const,
      content:
        'Translate the provided JSON object into the target language. Return JSON only, with the exact same keys, no markdown, no commentary, and preserve placeholders, punctuation, line breaks, artist names, and product names exactly. Address the user informally (for example du, tu, je, ty, ты, ти, sen), and write a dash as a plain hyphen, never an em dash, en dash or double hyphen.',
    },
    { role: 'user' as const, content: user.join('\n\n') },
  ]
}

export function findStaleSourceKeys(
  source: Record<string, string>,
  lock: Record<string, string>,
): string[] {
  const { changed, added } = findSourceLockDrift(source, lock)
  return [...changed, ...added]
}

function quoteCatalogValue(value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n')
  return value.includes("'") ? `"${escaped.replace(/"/g, '\\"')}"` : `'${escaped}'`
}

// Rewrites only the given keys of a locale catalog file, inserting new keys
// after the closest preceding key in English order. Biome reflows the result.
export function applyCatalogUpdates(
  fileText: string,
  updates: Record<string, string>,
  keyOrder: string[],
): string {
  const lines = fileText.split('\n')
  const findEntry = (key: string): [number, number] | null => {
    const start = lines.findIndex((line) => line.startsWith(`  '${key}':`))
    if (start < 0) return null
    let end = start
    while (end < lines.length - 1 && !lines[end]?.trimEnd().endsWith(',')) end++
    return [start, end]
  }
  for (const key of keyOrder) {
    const value = updates[key]
    if (value === undefined) continue
    const entry = `  '${key}': ${quoteCatalogValue(value)},`
    const existing = findEntry(key)
    if (existing) {
      lines.splice(existing[0], existing[1] - existing[0] + 1, entry)
      continue
    }
    const earlier = keyOrder.slice(0, keyOrder.indexOf(key)).reverse()
    const anchor = earlier.map(findEntry).find((found) => found != null)
    const insertAt = anchor ? anchor[1] + 1 : lines.findIndex((line) => line.endsWith('{')) + 1
    lines.splice(insertAt, 0, entry)
  }
  return lines.join('\n')
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

    for (const term of PROTECTED_I18N_TERMS) {
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
  source = sourceMessages,
  previous = {},
}: {
  baseUrl: string
  model: string
  targetLocale: string
  source?: Record<string, string>
  previous?: Record<string, string>
}): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  const requestedKeys = Object.keys(source)
  const messages = buildTranslationMessages(sourceLocale, targetLocale, source, previous)

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

  for (const key of requestedKeys) {
    const value = parsed[key]
    if (typeof value !== 'string') {
      if (value === undefined) missing.push(key)
      else invalid.push(key)
      continue
    }
    catalog[key] = value
  }

  const extra = Object.keys(parsed).filter((key) => !requestedKeys.includes(key))
  if (missing.length > 0 || invalid.length > 0 || extra.length > 0) {
    const parts: string[] = []
    if (missing.length > 0) parts.push(`missing: ${missing.join(', ')}`)
    if (invalid.length > 0) parts.push(`non-string: ${invalid.join(', ')}`)
    if (extra.length > 0) parts.push(`extra: ${extra.join(', ')}`)
    throw new Error(`Translated catalog failed validation (${parts.join('; ')})`)
  }

  validateTranslatedCatalog(source, catalog)

  return catalog
}

async function translateStale(): Promise<void> {
  const source = getRawMessages(sourceLocale) as Record<string, string>
  const staleKeys = findStaleSourceKeys(source, readSourceLock())
  if (staleKeys.length === 0) {
    console.log('No English changes since the last stamp.')
    return
  }
  const named = args.filter((arg) => !arg.startsWith('-'))
  const locales = (named.length > 0 ? named : SUPPORTED_LOCALES).filter((l) => l !== sourceLocale)
  const subset = Object.fromEntries(staleKeys.map((key) => [key, source[key] as string]))
  const keyOrder = Object.keys(source)
  for (const locale of locales) {
    if (!SUPPORTED_LOCALES.includes(locale as (typeof SUPPORTED_LOCALES)[number])) {
      throw new Error(`Unsupported locale: ${locale}`)
    }
    const current = getRawMessages(locale as (typeof SUPPORTED_LOCALES)[number]) as Record<
      string,
      string
    >
    const previous = Object.fromEntries(
      staleKeys.filter((key) => current[key] != null).map((key) => [key, current[key] as string]),
    )
    const translated = await translateCatalog({
      baseUrl: baseUrl as string,
      model,
      targetLocale: locale,
      source: subset,
      previous,
    })
    for (const key of Object.keys(translated)) {
      translated[key] = (translated[key] as string)
        .replace(/(\d)\s*[\u2013\u2014]\s*(\d)/g, '$1-$2')
        .replace(/\s*(?:[\u2013\u2014]+|--)\s*/g, ' - ')
    }
    if (!writeOutput) {
      console.log(JSON.stringify({ [locale]: translated }, null, 2))
      continue
    }
    const file = path.resolve(scriptDir, `../src/core/i18n/messages/${locale}.ts`)
    await writeFile(file, applyCatalogUpdates(await readFile(file, 'utf8'), translated, keyOrder))
    console.log(`Updated ${staleKeys.length} keys in ${locale}`)
  }
  if (writeOutput)
    console.log('Review the changes, run `bun run lint:fix`, then `bun run i18n:stamp`.')
}

export async function main(): Promise<void> {
  if (staleOnly) {
    if (!baseUrl) {
      console.error('TRANSLATION_BASE_URL must be set for translation generation')
      process.exit(1)
    }
    await translateStale()
    return
  }

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
