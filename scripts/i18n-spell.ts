#!/usr/bin/env bun

/**
 * Advisory spell check of the translated catalogs with hunspell.
 *
 * Usage: bun scripts/i18n-spell.ts [<locale>...] [--strict]
 *
 * Needs `hunspell` and the locale dictionaries (Debian/Ubuntu: hunspell-de-de,
 * hunspell-fr, ...; or point DICPATH at a folder of .aff/.dic files). Locales
 * without a dictionary are skipped and named. Reports only, unless --strict.
 * Words that are correct but unknown to the dictionary go in
 * scripts/i18n-spell-allowlist.txt.
 */

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { SUPPORTED_LOCALES } from '../src/core/i18n/locales'
import { getRawMessages } from '../src/core/i18n/messages'
import { PROTECTED_I18N_TERMS } from '../src/core/i18n/protected-terms'

const DICTIONARIES: Partial<Record<string, string>> = {
  de: 'de_DE',
  es: 'es_ES',
  fr: 'fr_FR',
  it: 'it_IT',
  nl: 'nl_NL',
  pl: 'pl_PL',
  'pt-BR': 'pt_BR',
  ro: 'ro_RO',
  ru: 'ru_RU',
  tr: 'tr_TR',
  uk: 'uk_UA',
}

const ALLOWLIST_PATH = 'scripts/i18n-spell-allowlist.txt'

export function loadAllowlist(text: string): Set<string> {
  return new Set(
    text
      .split('\n')
      .map((line) => line.replace(/#.*/, '').trim())
      .filter(Boolean),
  )
}

// Strips what a dictionary cannot know: placeholders, URLs, product names, code.
export function prepareForSpellCheck(value: string): string {
  let text = value
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/\b[A-Z0-9_]{2,}\b/g, ' ')
  for (const term of PROTECTED_I18N_TERMS) text = text.split(term).join(' ')
  // Removing a name from a compound ("API-Schlüssel") leaves a dangling hyphen.
  return text
    .replace(/(^|\s)-+|-+(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Parses `hunspell -a` output: one block per input line, blank-line separated.
export function parseHunspellPipe(output: string, lineCount: number): string[][] {
  const blocks = output.split('\n').slice(1).join('\n').split('\n\n')
  return Array.from({ length: lineCount }, (_, i) =>
    (blocks[i] ?? '')
      .split('\n')
      .filter((line) => line.startsWith('& ') || line.startsWith('# '))
      .map((line) => line.split(' ')[1] as string),
  )
}

function dictionaryAvailable(dict: string): boolean {
  const probe = spawnSync('hunspell', ['-d', dict, '-l'], { input: 'test\n', encoding: 'utf8' })
  return probe.status === 0 && !/Can't open affix or dictionary/i.test(probe.stderr ?? '')
}

function main(): void {
  const args = process.argv.slice(2)
  const strict = args.includes('--strict')
  const named = args.filter((arg) => !arg.startsWith('-'))
  const locales = (named.length > 0 ? named : SUPPORTED_LOCALES).filter((l) => DICTIONARIES[l])
  if (spawnSync('hunspell', ['-v']).status !== 0) {
    console.error('hunspell is not installed; skipping the spell check.')
    process.exit(strict ? 1 : 0)
  }

  const allowlist = loadAllowlist(readFileSync(ALLOWLIST_PATH, 'utf8'))
  const skipped: string[] = []
  let total = 0
  for (const locale of locales) {
    const dict = DICTIONARIES[locale] as string
    if (!dictionaryAvailable(dict)) {
      skipped.push(`${locale} (${dict})`)
      continue
    }
    const messages = getRawMessages(locale as (typeof SUPPORTED_LOCALES)[number]) as Record<
      string,
      string
    >
    const keys = Object.keys(messages)
    const input = keys.map((key) => `^${prepareForSpellCheck(messages[key] ?? '')}`).join('\n')
    const run = spawnSync('hunspell', ['-a', '-d', dict], {
      input: `${input}\n`,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
    const results = parseHunspellPipe(run.stdout ?? '', keys.length)
    const hits = keys
      .map((key, i) => [key, (results[i] ?? []).filter((word) => !allowlist.has(word))] as const)
      .filter(([, words]) => words.length > 0)
    total += hits.length
    if (hits.length === 0) continue
    // One line per unknown word, so a typo stands out from repeated jargon.
    const byWord = new Map<string, string[]>()
    for (const [key, words] of hits) {
      for (const word of new Set(words)) byWord.set(word, [...(byWord.get(word) ?? []), key])
    }
    console.log(`${locale}: ${byWord.size} unknown words in ${hits.length} strings`)
    for (const [word, keys] of [...byWord].sort(([a], [b]) => a.localeCompare(b))) {
      const more = keys.length > 1 ? ` (+${keys.length - 1})` : ''
      console.log(`  ${word}  ${keys[0]}${more}`)
    }
  }
  if (skipped.length > 0) console.log(`No dictionary installed for: ${skipped.join(', ')}`)
  console.log(total === 0 ? 'No unknown words.' : `${total} strings flagged (advisory).`)
  if (strict && total > 0) process.exit(1)
}

if (import.meta.main) main()
