#!/usr/bin/env bun

/**
 * Re-record the English source hashes after translations were updated.
 *
 * Usage: bun scripts/i18n-stamp.ts [--base <ref>] [--source-only <key>[,<key>...]]
 *
 * A key whose English changed is stamped only when every translated locale
 * also changed that key since <base> (default: merge-base with develop).
 * Pass --source-only for English edits that need no translation change
 * (typo, casing); the flag is the explicit acknowledgment.
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SUPPORTED_LOCALES } from '../src/core/i18n/locales'
import { getRawMessages } from '../src/core/i18n/messages'
import {
  computeSourceLock,
  findSourceLockDrift,
  readSourceLock,
  writeSourceLock,
} from './i18n-source-lock'

type Catalog = Record<string, string>

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function resolveBase(): string {
  const explicit = argValue('--base')
  if (explicit) return git('rev-parse', '--verify', explicit)
  for (const ref of ['github/develop', 'origin/develop', 'develop']) {
    try {
      return git('merge-base', 'HEAD', ref)
    } catch {
      // try the next candidate
    }
  }
  throw new Error('Could not find a develop branch to compare against; pass --base <ref>.')
}

async function catalogAt(ref: string, locale: string, dir: string): Promise<Catalog> {
  let text: string
  try {
    text = git('show', `${ref}:src/core/i18n/messages/${locale}.ts`)
  } catch {
    return {}
  }
  const file = join(dir, `${locale}-${Date.now()}.ts`)
  writeFileSync(file, text)
  const mod = (await import(file)) as Record<string, Catalog>
  return Object.values(mod)[0] ?? {}
}

const source = getRawMessages('en') as Catalog
const lock = readSourceLock()
const { changed } = findSourceLockDrift(source, lock)
const sourceOnly = new Set(
  (argValue('--source-only') ?? '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean),
)

const untouched: string[] = []
if (changed.length > 0) {
  const base = resolveBase()
  const dir = mkdtempSync(join(tmpdir(), 'i18n-stamp-'))
  try {
    for (const locale of SUPPORTED_LOCALES) {
      if (locale === 'en') continue
      const before = await catalogAt(base, locale, dir)
      const now = getRawMessages(locale) as Catalog
      for (const key of changed) {
        if (sourceOnly.has(key)) continue
        if (before[key] != null && before[key] === now[key]) untouched.push(`${locale}:${key}`)
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

if (untouched.length > 0) {
  console.error('English changed but these translations did not:')
  for (const entry of untouched) console.error(`  - ${entry}`)
  console.error(
    'Update them, or pass --source-only <key> if the English edit needs no translation change.',
  )
  process.exit(1)
}

writeSourceLock(computeSourceLock(source))
console.log(`Stamped ${Object.keys(source).length} keys (${changed.length} changed).`)
