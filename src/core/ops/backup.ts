import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTableColumns, getTableName, sql } from 'drizzle-orm'
import type { AnyPgColumn, AnyPgTable } from 'drizzle-orm/pg-core'
import {
  getKeyFingerprint,
  SENSITIVE_OAUTH,
  SENSITIVE_SETTINGS,
  SENSITIVE_TARGET_CONFIG,
  SENSITIVE_USER_CONNECTIONS,
} from '@/core/crypto'
import {
  artistMetadata,
  artists,
  genres,
  jobRuns,
  oauthTokens,
  oidcTokens,
  playlists,
  playlistTracks,
  recommendationBatches,
  recommendations,
  settings,
  subscriptions,
  targets,
  users,
} from '@/db/schema'
import type { BackupFile, BackupOptions, OpsDb, RestoreOptions, RestoreResult } from './types'

type BackupTable =
  | typeof artistMetadata
  | typeof artists
  | typeof genres
  | typeof jobRuns
  | typeof oauthTokens
  | typeof oidcTokens
  | typeof playlists
  | typeof playlistTracks
  | typeof recommendationBatches
  | typeof recommendations
  | typeof settings
  | typeof subscriptions
  | typeof targets
  | typeof users

function getAppVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8'))
    return pkg.version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

async function selectAll(db: OpsDb, table: BackupTable): Promise<Record<string, unknown>[]> {
  return db.select().from(table as AnyPgTable) as unknown as Record<string, unknown>[]
}

export async function createBackup(db: OpsDb, options: BackupOptions = {}): Promise<BackupFile> {
  const { includeCaches = false } = options

  const [
    settingsRows,
    userRows,
    oauthRows,
    oidcRows,
    targetRows,
    subRows,
    jobRunRows,
    batchRows,
    recRows,
    playlistRows,
    trackRows,
  ] = await Promise.all([
    selectAll(db, settings),
    selectAll(db, users),
    selectAll(db, oauthTokens),
    selectAll(db, oidcTokens),
    selectAll(db, targets),
    selectAll(db, subscriptions),
    selectAll(db, jobRuns),
    selectAll(db, recommendationBatches),
    selectAll(db, recommendations),
    selectAll(db, playlists),
    selectAll(db, playlistTracks),
  ])

  const backup: BackupFile = {
    version: 1,
    appVersion: getAppVersion(),
    createdAt: new Date().toISOString(),
    encryptionKeyHash: getKeyFingerprint(),
    includesCaches: includeCaches,
    data: {
      settings: settingsRows,
      users: userRows,
      oauthTokens: oauthRows,
      oidcTokens: oidcRows,
      targets: targetRows,
      subscriptions: subRows,
      jobRuns: jobRunRows,
      recommendationBatches: batchRows,
      recommendations: recRows,
      playlists: playlistRows,
      playlistTracks: trackRows,
    },
  }

  if (includeCaches) {
    const [artistRows, genreRows, metaRows] = await Promise.all([
      selectAll(db, artists),
      selectAll(db, genres),
      selectAll(db, artistMetadata),
    ])
    backup.data.artists = artistRows
    backup.data.genres = genreRows
    backup.data.artistMetadata = metaRows
  }

  return backup
}

// ── Restore ────────────────────────────────────

const ENCRYPTED_FIELD_MAP: Record<string, readonly string[]> = {
  settings: SENSITIVE_SETTINGS,
  users: SENSITIVE_USER_CONNECTIONS,
  oauthTokens: SENSITIVE_OAUTH,
  oidcTokens: SENSITIVE_OAUTH,
  targets: SENSITIVE_TARGET_CONFIG,
}

function filterToSchemaColumns<TTable extends BackupTable>(
  table: TTable,
  row: Record<string, unknown>,
): Partial<TTable['$inferInsert']> {
  const columns = getTableColumns(table)
  const filtered: Record<string, unknown> = {}
  for (const [key, col] of Object.entries(columns) as [string, { dataType: string }][]) {
    if (!(key in row)) continue
    const value = row[key]
    // JSON.parse turns Date objects into ISO strings; drizzle needs Date objects for timestamps
    if (col.dataType === 'date' && typeof value === 'string') {
      filtered[key] = new Date(value)
    } else {
      filtered[key] = value
    }
  }
  return filtered as Partial<TTable['$inferInsert']>
}

function getDefaultConflictTarget<TTable extends BackupTable>(table: TTable): AnyPgColumn {
  const columns = getTableColumns(table)
  return columns.id as AnyPgColumn
}

type RestoreTx = Parameters<Parameters<OpsDb['transaction']>[0]>[0]

type RestoreSpec<TTable extends BackupTable> = {
  key: keyof BackupFile['data']
  table: TTable
  clear: (tx: RestoreTx) => Promise<void>
  restore: (tx: RestoreTx, rows: Record<string, unknown>[]) => Promise<void>
  resetSequence: (tx: RestoreTx) => Promise<void>
}

function createRestoreSpec<TTable extends BackupTable>(
  key: keyof BackupFile['data'],
  table: TTable,
  conflictTarget?: AnyPgColumn,
): RestoreSpec<TTable> {
  return {
    key,
    table,
    async clear(tx) {
      await tx.delete(table)
    },
    async restore(tx, rows) {
      const target = conflictTarget ?? getDefaultConflictTarget(table)
      for (const row of rows) {
        const safeRow = filterToSchemaColumns(table, row) as TTable['$inferInsert']
        await tx
          .insert(table)
          .values(safeRow as never)
          .onConflictDoUpdate({
            target,
            set: safeRow as never,
          })
      }
    },
    async resetSequence(tx) {
      const columns = getTableColumns(table)
      const idColumn = columns.id as AnyPgColumn | undefined
      if (!idColumn) return

      await tx.execute(sql`
        SELECT setval(
          pg_get_serial_sequence(${`public.${getTableName(table)}`}, 'id'),
          COALESCE((SELECT MAX(${idColumn}) FROM ${table}), 0) + 1,
          false
        )
      `)
    },
  }
}

// Table restore order respects FK dependencies
const RESTORE_ORDER = [
  createRestoreSpec('settings', settings, settings.id),
  createRestoreSpec('users', users),
  createRestoreSpec('artists', artists, artists.mbid),
  createRestoreSpec('genres', genres, genres.slug),
  createRestoreSpec('artistMetadata', artistMetadata, artistMetadata.nameNormalized),
  createRestoreSpec('oauthTokens', oauthTokens),
  createRestoreSpec('oidcTokens', oidcTokens),
  createRestoreSpec('targets', targets),
  createRestoreSpec('subscriptions', subscriptions),
  createRestoreSpec('playlists', playlists),
  createRestoreSpec('recommendationBatches', recommendationBatches),
  createRestoreSpec('jobRuns', jobRuns),
  createRestoreSpec('recommendations', recommendations),
  createRestoreSpec('playlistTracks', playlistTracks),
] as const

function detectEncryptionMismatch(backup: BackupFile): { mismatch: boolean; fields: string[] } {
  const currentFp = getKeyFingerprint()
  const backupFp = backup.encryptionKeyHash

  if (!backupFp && !currentFp) return { mismatch: false, fields: [] }
  if (backupFp !== currentFp) {
    const fields: string[] = []
    for (const [tableKey, sensitiveFields] of Object.entries(ENCRYPTED_FIELD_MAP)) {
      const rows = backup.data[tableKey as keyof BackupFile['data']]
      if (rows && Array.isArray(rows) && rows.length > 0) {
        for (const field of sensitiveFields) {
          fields.push(`${tableKey}.${field}`)
        }
      }
    }
    return { mismatch: true, fields }
  }
  return { mismatch: false, fields: [] }
}

export async function restoreBackup(
  db: OpsDb,
  backup: BackupFile,
  options: RestoreOptions = {},
): Promise<RestoreResult> {
  if (backup.version !== 1) {
    throw new Error(`Unsupported backup version: ${backup.version}`)
  }

  const { mismatch, fields } = detectEncryptionMismatch(backup)

  if (mismatch && !options.force) {
    return {
      tablesRestored: {},
      warnings: ['Encryption key mismatch. Use force=true to restore anyway.'],
      encryptionMismatch: true,
      affectedEncryptedFields: fields,
    }
  }

  const tablesRestored: Record<string, number> = {}
  const warnings: string[] = []

  // Wrap in a transaction so partial failures roll back cleanly
  try {
    // Backward compatibility: map old subscriptionRuns to jobRuns format
    const backupData = backup.data as unknown as Record<string, unknown[]>
    if (backupData.subscriptionRuns?.length && !backup.data.jobRuns?.length) {
      backup.data.jobRuns = backupData.subscriptionRuns as Record<string, unknown>[]
    }

    await db.transaction(async (tx) => {
      const includedSpecs = RESTORE_ORDER.filter((spec) => Array.isArray(backup.data[spec.key]))

      for (const spec of [...includedSpecs].reverse()) {
        await spec.clear(tx)
      }

      for (const spec of RESTORE_ORDER) {
        const rows = backup.data[spec.key]
        if (!Array.isArray(rows) || rows.length === 0) continue

        await spec.restore(tx, rows)
        await spec.resetSequence(tx)
        tablesRestored[spec.key] = rows.length
      }
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    warnings.push(`Restore failed (rolled back): ${msg}`)
  }

  return {
    tablesRestored,
    warnings,
    encryptionMismatch: mismatch,
    affectedEncryptedFields: mismatch ? fields : [],
  }
}
