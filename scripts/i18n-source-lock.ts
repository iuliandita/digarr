import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

// Records which English text each key's translations were written against, so
// an English edit cannot land without the 14 translations being revisited.
export const SOURCE_LOCK_PATH = 'src/core/i18n/messages/source-lock.json'

export type SourceLock = Record<string, string>

export function hashSource(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12)
}

export function computeSourceLock(source: Record<string, string>): SourceLock {
  const lock: SourceLock = {}
  for (const key of Object.keys(source).sort()) lock[key] = hashSource(source[key] ?? '')
  return lock
}

export function readSourceLock(path = SOURCE_LOCK_PATH): SourceLock {
  if (!existsSync(path)) return {}
  return JSON.parse(readFileSync(path, 'utf8')) as SourceLock
}

export function writeSourceLock(lock: SourceLock, path = SOURCE_LOCK_PATH): void {
  const sorted: SourceLock = {}
  for (const key of Object.keys(lock).sort()) sorted[key] = lock[key] as string
  writeFileSync(path, `${JSON.stringify(sorted, null, 2)}\n`)
}

export function findSourceLockDrift(source: Record<string, string>, lock: SourceLock) {
  const changed: string[] = []
  const added: string[] = []
  for (const [key, value] of Object.entries(source)) {
    const recorded = lock[key]
    if (recorded == null) added.push(key)
    else if (recorded !== hashSource(value)) changed.push(key)
  }
  const removed = Object.keys(lock).filter((key) => !(key in source))
  return { changed, added, removed }
}
