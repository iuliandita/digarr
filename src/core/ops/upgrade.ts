import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { createBackup } from './backup'
import type { MigrationStatus, OpsDb, PreFlightResult } from './types'

interface JournalEntry {
  idx: number
  version: string
  when: number
  tag: string
  breakpoints: boolean
}

interface Journal {
  version: string
  dialect: string
  entries: JournalEntry[]
}

const JOURNAL_PATH = join(process.cwd(), 'drizzle', 'meta', '_journal.json')
const MAX_AUTO_BACKUPS = 5

function readJournal(): Journal | null {
  if (!existsSync(JOURNAL_PATH)) return null
  try {
    return JSON.parse(readFileSync(JOURNAL_PATH, 'utf-8'))
  } catch {
    return null
  }
}

export async function getPendingMigrations(db: OpsDb): Promise<MigrationStatus> {
  const journal = readJournal()
  if (!journal || journal.entries.length === 0) {
    return {
      currentVersion: null,
      targetVersion: null,
      pendingCount: 0,
      pendingMigrations: [],
      lastAutoBackup: getLastAutoBackup(),
    }
  }

  let appliedCount = 0
  try {
    const rows = await (db as unknown as { execute: (q: unknown) => Promise<unknown[]> }).execute(
      sql`SELECT hash, created_at FROM "__drizzle_migrations" ORDER BY created_at`,
    )
    appliedCount = Array.isArray(rows) ? rows.length : 0
  } catch {
    // Table doesn't exist yet (completely fresh DB)
    appliedCount = 0
  }

  const allEntries = journal.entries.sort((a, b) => a.idx - b.idx)
  const pendingEntries = allEntries.slice(appliedCount)

  return {
    currentVersion: appliedCount > 0 ? (allEntries[appliedCount - 1]?.tag ?? null) : null,
    targetVersion: allEntries.length > 0 ? (allEntries[allEntries.length - 1]?.tag ?? null) : null,
    pendingCount: pendingEntries.length,
    pendingMigrations: pendingEntries.map((e) => e.tag),
    lastAutoBackup: getLastAutoBackup(),
  }
}

function getBackupDir(): string {
  return process.env.DIGARR_BACKUP_DIR ?? join(process.cwd(), 'backups')
}

function getLastAutoBackup(): MigrationStatus['lastAutoBackup'] {
  const dir = getBackupDir()
  if (!existsSync(dir)) return null

  const files = readdirSync(dir)
    .filter((f) => f.startsWith('pre-migrate-') && f.endsWith('.json'))
    .sort()
    .reverse()

  const first = files[0]
  if (!first) return null
  const path = join(dir, first)
  try {
    const stat = statSync(path)
    return { path, createdAt: stat.mtime.toISOString() }
  } catch {
    return null
  }
}

function pruneOldBackups(dir: string): void {
  const files = readdirSync(dir)
    .filter((f) => f.startsWith('pre-migrate-') && f.endsWith('.json'))
    .map((f) => ({ name: f, mtime: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)

  for (const file of files.slice(MAX_AUTO_BACKUPS)) {
    try {
      unlinkSync(join(dir, file.name))
    } catch {
      // Best effort
    }
  }
}

export async function autoBackup(
  db: OpsDb,
  fromVersion: string | null,
  toVersion: string | null,
): Promise<string | null> {
  const dir = getBackupDir()
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    return null
  }

  const backup = await createBackup(db, { includeCaches: false })
  const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)
  const from = fromVersion ?? 'fresh'
  const to = toVersion ?? 'unknown'
  const filename = `pre-migrate-${ts}-${from}-${to}.json`
  const filepath = join(dir, filename)

  writeFileSync(filepath, JSON.stringify(backup, null, 2), 'utf-8')
  pruneOldBackups(dir)

  return filepath
}

export async function runPreFlightCheck(db: OpsDb): Promise<PreFlightResult> {
  const autoBackupEnabled = process.env.DIGARR_AUTO_BACKUP !== 'false'

  const status = await getPendingMigrations(db)

  if (status.pendingCount === 0) {
    return { pendingCount: 0, backupPath: null, backupSkipped: false, backupError: null }
  }

  console.log(
    `[ops] ${status.pendingCount} pending migration(s) detected` +
      ` (current: ${status.currentVersion ?? 'none'}, target: ${status.targetVersion})`,
  )

  if (!autoBackupEnabled) {
    console.log('[ops] Auto-backup disabled (DIGARR_AUTO_BACKUP=false)')
    return {
      pendingCount: status.pendingCount,
      backupPath: null,
      backupSkipped: true,
      backupError: null,
    }
  }

  try {
    const path = await autoBackup(db, status.currentVersion, status.targetVersion)
    if (path) {
      console.log(`[ops] Auto-backup saved to ${path}`)
    }
    return {
      pendingCount: status.pendingCount,
      backupPath: path,
      backupSkipped: false,
      backupError: null,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[ops] Auto-backup failed: ${msg}`)
    return {
      pendingCount: status.pendingCount,
      backupPath: null,
      backupSkipped: false,
      backupError: msg,
    }
  }
}
