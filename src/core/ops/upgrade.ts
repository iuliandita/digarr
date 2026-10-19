import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { basename, join } from 'node:path'
import { sql } from 'drizzle-orm'
import { writeBackupSnapshot } from './backup'
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
const MAX_AUTO_BACKUPS = 14

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
    const result = await (
      db as unknown as { execute: (q: unknown) => Promise<{ rows: unknown[] }> }
    ).execute(sql`SELECT hash, created_at FROM drizzle."__drizzle_migrations" ORDER BY created_at`)
    appliedCount = Array.isArray(result.rows) ? result.rows.length : 0
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

async function hasExistingAppTables(db: OpsDb): Promise<boolean> {
  try {
    const result = await (
      db as unknown as {
        execute: (q: unknown) => Promise<{ rows: Array<Record<string, unknown>> }>
      }
    ).execute(sql`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('settings', 'users')
      ) AS has_tables
    `)

    const row = Array.isArray(result.rows) ? result.rows[0] : null
    return row?.has_tables === true
  } catch {
    // Be conservative on query failures and keep backup enabled.
    return true
  }
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
  const fullPath = join(dir, first)
  try {
    const stat = statSync(fullPath)
    return { filename: basename(fullPath), createdAt: stat.mtime.toISOString() }
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
): Promise<string> {
  const dir = getBackupDir()
  mkdirSync(dir, { recursive: true, mode: 0o700 })

  const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 17)
  const from = fromVersion ?? 'fresh'
  const to = toVersion ?? 'unknown'
  const filename = `pre-migrate-${ts}-${from}-${to}.json`
  const filepath = join(dir, filename)

  // Write under a name the listing ignores, so a failed write never counts as the latest backup.
  const tmpPath = join(dir, `.${filename}.tmp`)
  let absentSchema: Awaited<ReturnType<typeof writeBackupSnapshot>>['absentSchema']
  try {
    const fd = openSync(tmpPath, 'w', 0o600)
    try {
      ;({ absentSchema } = await writeBackupSnapshot(
        db,
        (chunk) => {
          const bytes = Buffer.from(chunk, 'utf-8')
          for (let offset = 0; offset < bytes.length; ) {
            offset += writeSync(fd, bytes, offset)
          }
        },
        { includeCaches: true, tolerateMissingSchema: true },
      ))
    } finally {
      closeSync(fd)
    }
    renameSync(tmpPath, filepath)
  } catch (error) {
    rmSync(tmpPath, { force: true })
    throw error
  }
  pruneOldBackups(dir)

  if (absentSchema) {
    const { tables, columns } = absentSchema
    const missing = [
      ...tables,
      ...Object.entries(columns).map(([t, cols]) => `${t}(${cols.join(', ')})`),
    ]
    console.log(`[ops] Snapshot omits schema not present yet: ${missing.join(', ')}`)
  }

  return filepath
}

type Executor = Pick<OpsDb, 'execute'>

async function columnExists(db: Executor, table: string, column: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
  `)
  return result.rows.length > 0
}

// 0024 adds partial unique indexes on users(email) and users(oidc_subject). Deleting a user would
// cascade through all of their data, so the oldest account keeps the identifier and the others
// lose it, like 0026 does for extra admins.
async function clearDuplicateUserIdentifiers(db: Executor): Promise<Record<string, number[]>> {
  const cleared: Record<string, number[]> = {}
  for (const column of ['email', 'oidc_subject']) {
    if (!(await columnExists(db, 'users', column))) continue
    const col = sql.identifier(column)
    const result = await db.execute(sql`
      UPDATE users SET ${col} = NULL
      WHERE id IN (
        SELECT id FROM (
          SELECT id, row_number() OVER (PARTITION BY ${col} ORDER BY id ASC) AS rn
          FROM users WHERE ${col} IS NOT NULL
        ) ranked WHERE rn > 1
      )
      RETURNING id
    `)
    const ids = result.rows.map((r) => Number((r as { id: unknown }).id)).sort((a, b) => a - b)
    if (ids.length > 0) cleared[column] = ids
  }
  return cleared
}

// 0028 rebuilds these natural keys as NULLS NOT DISTINCT; PARTITION BY already groups NULLs.
// Nothing references these tables, and the newest row is the latest sync cursor or override.
const LIBRARY_NATURAL_KEYS = [
  { table: 'library_sync_state', key: ['user_id', 'source'], order: sql`id DESC` },
  {
    table: 'library_match_overrides',
    key: ['user_id', 'source', 'source_artist_id'],
    order: sql`updated_at DESC, id DESC`,
  },
  {
    table: 'library_album_match_overrides',
    key: ['user_id', 'source', 'source_album_id'],
    order: sql`updated_at DESC, id DESC`,
  },
] as const

async function deleteDuplicateLibraryRows(db: Executor): Promise<Record<string, number>> {
  const removed: Record<string, number> = {}
  for (const { table, key, order } of LIBRARY_NATURAL_KEYS) {
    const exists = await db.execute(sql`SELECT to_regclass(${`public.${table}`}) IS NOT NULL AS ok`)
    if ((exists.rows[0] as { ok?: boolean } | undefined)?.ok !== true) continue
    const tbl = sql.identifier(table)
    const partition = sql.join(
      key.map((c) => sql.identifier(c)),
      sql`, `,
    )
    const result = await db.execute(sql`
      DELETE FROM ${tbl}
      WHERE id IN (
        SELECT id FROM (
          SELECT id, row_number() OVER (PARTITION BY ${partition} ORDER BY ${order}) AS rn
          FROM ${tbl}
        ) ranked WHERE rn > 1
      )
      RETURNING id
    `)
    if (result.rows.length > 0) removed[table] = result.rows.length
  }
  return removed
}

// Runs after the auto-backup and before migrations, only while the index-building migration is pending.
export async function dedupeBeforeUniqueIndexes(
  db: OpsDb,
  pendingMigrations: string[],
): Promise<void> {
  const usersPending = pendingMigrations.some((m) => m.startsWith('0024_'))
  const libraryPending = pendingMigrations.some((m) => m.startsWith('0028_'))
  if (!usersPending && !libraryPending) return

  await db.transaction(async (tx) => {
    if (usersPending) {
      for (const [column, ids] of Object.entries(await clearDuplicateUserIdentifiers(tx))) {
        console.warn(
          `[ops] Cleared duplicate users.${column} on ${ids.length} account(s) before migration 0024 (user ids: ${ids.join(', ')}). The oldest account kept the value; review these accounts.`,
        )
      }
    }
    if (libraryPending) {
      for (const [table, count] of Object.entries(await deleteDuplicateLibraryRows(tx))) {
        console.warn(`[ops] Removed ${count} duplicate row(s) from ${table} before migration 0028`)
      }
    }
  })
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

  if (status.currentVersion === null && !(await hasExistingAppTables(db))) {
    console.log('[ops] Fresh database detected; skipping auto-backup before initial migrations')
    return {
      pendingCount: status.pendingCount,
      backupPath: null,
      backupSkipped: true,
      backupError: null,
    }
  }

  if (!autoBackupEnabled) {
    console.log('[ops] Auto-backup disabled (DIGARR_AUTO_BACKUP=false)')
    await dedupeBeforeUniqueIndexes(db, status.pendingMigrations)
    return {
      pendingCount: status.pendingCount,
      backupPath: null,
      backupSkipped: true,
      backupError: null,
    }
  }

  let path: string
  try {
    path = await autoBackup(db, status.currentVersion, status.targetVersion)
  } catch (error) {
    console.error(
      '[ops] Pre-migration backup failed and no migrations were applied. Take a native pg_dump -Fc (or copy the PGlite data directory), verify it restores, then fix the cause. DIGARR_AUTO_BACKUP=false skips this step for one upgrade only once that backup exists.',
    )
    throw error
  }
  console.log(`[ops] Auto-backup saved to ${path}`)
  await dedupeBeforeUniqueIndexes(db, status.pendingMigrations)
  return {
    pendingCount: status.pendingCount,
    backupPath: path,
    backupSkipped: false,
    backupError: null,
  }
}
