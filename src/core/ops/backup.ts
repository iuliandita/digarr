import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTableColumns, getTableName, sql } from 'drizzle-orm'
import type { AnyPgColumn, AnyPgTable } from 'drizzle-orm/pg-core'
import { getTableConfig } from 'drizzle-orm/pg-core'
import {
  getKeyFingerprint,
  SENSITIVE_OAUTH,
  SENSITIVE_SETTINGS,
  SENSITIVE_TARGET_CONFIG,
  SENSITIVE_USER_CONNECTIONS,
} from '@/core/crypto'
import {
  albumBlocks,
  artistBlocks,
  artistGenreAliases,
  artistMetadata,
  artists,
  genres,
  jobRuns,
  libraryAlbumMatchOverrides,
  libraryAlbums,
  libraryArtists,
  libraryHealthState,
  libraryMatchOverrides,
  librarySyncState,
  oauthTokens,
  playlistExports,
  playlists,
  playlistTracks,
  recommendationBatches,
  recommendations,
  recordingArtistCache,
  SLSKD_ACTIVE_JOB_STATES,
  settings,
  slskdJobs,
  subscriptions,
  targets,
  users,
} from '@/db/schema'
import type {
  BackupData,
  BackupFile,
  BackupOptions,
  OpsDb,
  RestoreOptions,
  RestoreResult,
} from './types'

type BackupTable =
  | typeof albumBlocks
  | typeof artistBlocks
  | typeof artistGenreAliases
  | typeof artistMetadata
  | typeof artists
  | typeof genres
  | typeof jobRuns
  | typeof libraryAlbumMatchOverrides
  | typeof libraryAlbums
  | typeof libraryArtists
  | typeof libraryHealthState
  | typeof libraryMatchOverrides
  | typeof librarySyncState
  | typeof oauthTokens
  | typeof playlistExports
  | typeof playlists
  | typeof playlistTracks
  | typeof recommendationBatches
  | typeof recommendations
  | typeof recordingArtistCache
  | typeof settings
  | typeof slskdJobs
  | typeof subscriptions
  | typeof targets
  | typeof users

export type DatabaseCopyMismatch = {
  table: string
  source: number
  target: number
  contentDiffers?: boolean
}

export type DatabaseCopyResult = {
  tablesRestored: Record<string, number>
  mismatches: DatabaseCopyMismatch[]
}

function getAppVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8'))
    return pkg.version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

async function selectAll(
  db: Pick<OpsDb, 'select'>,
  table: BackupTable,
): Promise<Record<string, unknown>[]> {
  return db.select().from(table as AnyPgTable) as unknown as Record<string, unknown>[]
}

function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
    )
  }
  return value
}

function tableHash(rows: Record<string, unknown>[]): string {
  const canonicalRows = rows.map((row) => JSON.stringify(canonical(row))).sort()
  return createHash('sha256').update(canonicalRows.join('\n')).digest('hex')
}

export async function createBackup(
  db: Pick<OpsDb, 'select'>,
  options: BackupOptions = {},
): Promise<BackupFile> {
  const { includeCaches = false, full = true } = options

  const settingsRows = await selectAll(db, settings)
  const userRows = await selectAll(db, users)
  const oauthRows = await selectAll(db, oauthTokens)
  const targetRows = await selectAll(db, targets)
  const subRows = await selectAll(db, subscriptions)
  const jobRunRows = await selectAll(db, jobRuns)
  const batchRows = await selectAll(db, recommendationBatches)
  const recRows = await selectAll(db, recommendations)
  const playlistRows = await selectAll(db, playlists)
  const trackRows = await selectAll(db, playlistTracks)
  const blockRows = await selectAll(db, artistBlocks)

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
      targets: targetRows,
      subscriptions: subRows,
      jobRuns: jobRunRows,
      recommendationBatches: batchRows,
      recommendations: recRows,
      playlists: playlistRows,
      playlistTracks: trackRows,
      playlistExports: await selectAll(db, playlistExports),
      artistBlocks: blockRows,
      artists: await selectAll(db, artists),
      artistGenreAliases: await selectAll(db, artistGenreAliases),
      genres: await selectAll(db, genres),
    },
  }

  if (includeCaches) {
    backup.data.artistMetadata = await selectAll(db, artistMetadata)
  }

  if (full) {
    backup.data.albumBlocks = await selectAll(db, albumBlocks)
    backup.data.libraryArtists = await selectAll(db, libraryArtists)
    backup.data.libraryAlbums = await selectAll(db, libraryAlbums)
    backup.data.librarySyncState = await selectAll(db, librarySyncState)
    backup.data.libraryMatchOverrides = await selectAll(db, libraryMatchOverrides)
    backup.data.libraryAlbumMatchOverrides = await selectAll(db, libraryAlbumMatchOverrides)
    backup.data.libraryHealthState = await selectAll(db, libraryHealthState)
    backup.data.recordingArtistCache = await selectAll(db, recordingArtistCache)
    backup.data.slskdJobs = await selectAll(db, slskdJobs)
  }

  return backup
}

export async function createBackupSnapshot(
  db: OpsDb,
  options: BackupOptions = {},
): Promise<BackupFile> {
  return db.transaction((tx) => createBackup(tx, options), {
    isolationLevel: 'repeatable read',
    accessMode: 'read only',
  })
}

// ── Restore ────────────────────────────────────

// Flags for the detectEncryptionMismatch warning. Entries may be top-level
// column names (e.g. 'lidarrApiKey') or nested jsonb paths in dotted form
// (e.g. 'preferences.fanartApiKey'). The detector only uses these labels for
// the surfaced error message, so dotted paths are a pure string contract.
const ENCRYPTED_FIELD_MAP: Record<string, readonly string[]> = {
  settings: [...SENSITIVE_SETTINGS, 'preferences.fanartApiKey'],
  users: SENSITIVE_USER_CONNECTIONS,
  oauthTokens: SENSITIVE_OAUTH,
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
  const columns = getTableColumns(table) as Record<string, AnyPgColumn | undefined>
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
  conflictTarget?: AnyPgColumn | AnyPgColumn[],
  sortRows?: (rows: Record<string, unknown>[]) => Record<string, unknown>[],
): RestoreSpec<TTable> {
  return {
    key,
    table,
    async clear(tx) {
      await tx.delete(table)
    },
    async restore(tx, rows) {
      if (rows.length === 0) return
      const target = conflictTarget ?? getDefaultConflictTarget(table)
      const columns = getTableColumns(table)
      // Build an excluded.* set clause once per table so the batched upsert
      // copies every inserted value onto existing rows. Drop `id` so the
      // original primary key is not overwritten with itself (harmless, but
      // noisier EXPLAIN output).
      const setClause: Record<string, ReturnType<typeof sql>> = {}
      for (const [jsName, col] of Object.entries(columns) as [string, AnyPgColumn][]) {
        if (jsName === 'id') continue
        setClause[jsName] = sql.raw(`excluded.${col.name}`)
      }
      const orderedRows = sortRows ? sortRows(rows) : rows
      const safeRows = orderedRows.map((row) => filterToSchemaColumns(table, row))
      // Postgres caps bind parameters at 65535. Keep chunks well below that:
      // assume up to ~30 cols per row, so 1000 rows = ~30k params with headroom.
      const CHUNK = 1000
      for (let i = 0; i < safeRows.length; i += CHUNK) {
        const chunk = safeRows.slice(i, i + CHUNK)
        await tx
          .insert(table)
          .values(chunk as never)
          .onConflictDoUpdate({ target, set: setClause as never })
      }
    },
    async resetSequence(tx) {
      const columns = getTableColumns(table) as Record<string, AnyPgColumn | undefined>
      const idColumn = columns.id
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

// Topo-sort genres so parents always precede their children during restore.
// Handles arbitrary depth. A cycle (which real genre data never has) emits in a
// stable order and surfaces as a clean FK error at restore, not a stack overflow.
function sortGenresParentsFirst(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const idMap = new Map<number, Record<string, unknown>>(rows.map((r) => [r.id as number, r]))
  const result: Record<string, unknown>[] = []
  const visited = new Set<number>()

  function visit(row: Record<string, unknown>) {
    const id = row.id as number
    if (visited.has(id)) return
    visited.add(id) // mark before recursing so a cycle terminates instead of overflowing
    const parentId = row.parentGenreId as number | null | undefined
    if (parentId != null) {
      const parentRow = idMap.get(parentId)
      if (parentRow) visit(parentRow)
    }
    result.push(row)
  }

  for (const row of rows) {
    visit(row)
  }
  return result
}

function normalizeSlskdRetryHistory(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const retryStates = new Set<string>([...SLSKD_ACTIVE_JOB_STATES, 'failed'])
  const groups = new Map<string, Record<string, unknown>[]>()
  const result = rows.map((row) => ({ ...row }))
  for (const row of result) {
    if (!retryStates.has(String(row.state))) continue
    const key = String(row.workKey)
    const group = groups.get(key) ?? []
    group.push(row)
    groups.set(key, group)
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue
    group.sort(
      (a, b) =>
        Number(a.state === 'failed') - Number(b.state === 'failed') ||
        new Date(String(b.updatedAt)).getTime() - new Date(String(a.updatedAt)).getTime() ||
        Number(b.id) - Number(a.id),
    )
    const winner = group[0]
    if (!winner) continue
    winner.attempts = Math.min(
      2147483647,
      group.reduce(
        (sum, row) => sum + Math.max(Number(row.attempts ?? 0), row.state === 'failed' ? 1 : 0),
        0,
      ),
    )
    for (const row of group.slice(1)) row.state = 'superseded'
  }
  return result
}

// Table restore order respects FK dependencies
const RESTORE_ORDER = [
  createRestoreSpec('settings', settings, settings.id),
  createRestoreSpec('users', users),
  createRestoreSpec('artists', artists, artists.mbid),
  createRestoreSpec('artistGenreAliases', artistGenreAliases, [
    artistGenreAliases.source,
    artistGenreAliases.nameNormalized,
  ]),
  createRestoreSpec('genres', genres, genres.slug, sortGenresParentsFirst),
  createRestoreSpec('artistMetadata', artistMetadata, artistMetadata.nameNormalized),
  createRestoreSpec('libraryHealthState', libraryHealthState),
  createRestoreSpec(
    'recordingArtistCache',
    recordingArtistCache,
    recordingArtistCache.recordingMbid,
  ),
  createRestoreSpec('oauthTokens', oauthTokens),
  createRestoreSpec('targets', targets),
  createRestoreSpec('subscriptions', subscriptions),
  createRestoreSpec('playlists', playlists),
  createRestoreSpec('recommendationBatches', recommendationBatches),
  createRestoreSpec('jobRuns', jobRuns),
  createRestoreSpec('recommendations', recommendations),
  createRestoreSpec('playlistTracks', playlistTracks),
  createRestoreSpec('playlistExports', playlistExports, [
    playlistExports.playlistId,
    playlistExports.targetId,
  ]),
  createRestoreSpec('artistBlocks', artistBlocks),
  createRestoreSpec('albumBlocks', albumBlocks),
  createRestoreSpec('libraryArtists', libraryArtists),
  createRestoreSpec('libraryAlbums', libraryAlbums),
  createRestoreSpec('librarySyncState', librarySyncState),
  createRestoreSpec('libraryMatchOverrides', libraryMatchOverrides),
  createRestoreSpec('libraryAlbumMatchOverrides', libraryAlbumMatchOverrides),
  createRestoreSpec('slskdJobs', slskdJobs, undefined, normalizeSlskdRetryHistory),
] as const

// Map from backup data key to the table object for external consumers
export const BACKUP_TABLE_BY_KEY = Object.fromEntries(
  RESTORE_ORDER.map((spec) => [spec.key as keyof BackupData, spec.table]),
) as Partial<Record<keyof BackupData, AnyPgTable>>

export class DatabaseCopyTargetNotEmptyError extends Error {
  constructor(public readonly affectedTables: string[]) {
    super('Target database is not empty. Re-run with overwrite=true to replace its contents.')
    this.name = 'DatabaseCopyTargetNotEmptyError'
  }
}

function targetProbeRows(result: unknown): Record<string, unknown>[] {
  const rows = (result as { rows?: unknown } | null)?.rows
  if (
    !Array.isArray(rows) ||
    rows.some((row) => row === null || typeof row !== 'object' || Array.isArray(row))
  ) {
    throw new Error('Cannot verify target database emptiness: invalid query response.')
  }
  return rows
}

export async function assertDatabaseCopyTargetEmpty(
  db: Pick<OpsDb, 'execute'>,
  options: { allowMissingTables?: boolean } = {},
): Promise<void> {
  for (const spec of RESTORE_ORDER) {
    const name = getTableName(spec.table)
    if (options.allowMissingTables) {
      const rows = targetProbeRows(
        await db.execute(sql`SELECT pg_catalog.to_regclass(${`"${name}"`}) IS NOT NULL AS present`),
      )
      if (rows.length !== 1 || typeof rows[0]?.present !== 'boolean') {
        throw new Error('Cannot verify target database emptiness: invalid catalog response.')
      }
      if (!rows[0].present) continue
    }
    const rows = targetProbeRows(
      await db.execute(sql`SELECT 1 AS present FROM ${sql.identifier(name)} LIMIT 1`),
    )
    if (rows.length > 1 || (rows.length === 1 && rows[0]?.present !== 1)) {
      throw new Error('Cannot verify target database emptiness: invalid table response.')
    }
    if (rows.length > 0) throw new DatabaseCopyTargetNotEmptyError([name])
  }
}

export class PartialBackupConflictError extends Error {
  constructor(
    public readonly affectedTables: string[],
    detail?: string,
  ) {
    super(detail ?? `Partial backup would alter omitted tables: ${affectedTables.join(', ')}`)
    this.name = 'PartialBackupConflictError'
  }
}

async function checkRestoreSafety(tx: RestoreTx, backup: BackupFile): Promise<void> {
  const included = RESTORE_ORDER.filter((spec) => Array.isArray(backup.data[spec.key]))
  const includedTables = new Set<AnyPgTable>(included.map((spec) => spec.table))
  const omittedReferences = RESTORE_ORDER.filter((spec) => !includedTables.has(spec.table)).map(
    (spec) => ({
      spec,
      references: getTableConfig(spec.table)
        .foreignKeys.map((fk) => fk.reference())
        .filter((ref) => includedTables.has(ref.foreignTable)),
    }),
  )
  const lockedTables = new Set<AnyPgTable>(includedTables)
  for (const { spec, references } of omittedReferences) {
    if (references.length > 0) lockedTables.add(spec.table)
  }
  // Retained artists must remain stable while validating legacy references.
  lockedTables.add(artists)
  const tableNames = [...lockedTables].map(getTableName).sort()
  await tx.execute(
    sql`LOCK TABLE ${sql.join(
      tableNames.map((name) => sql.identifier(name)),
      sql`, `,
    )} IN SHARE ROW EXCLUSIVE MODE`,
  )

  const affectedTables: string[] = []
  for (const { spec, references } of omittedReferences) {
    if (references.length === 0) continue
    const conditions = references.map((ref) =>
      sql.join(
        ref.columns.map((column) => sql`${column} IS NOT NULL`),
        sql` AND `,
      ),
    )
    const result = await tx.execute(
      sql`SELECT 1 FROM ${spec.table} WHERE ${sql.join(
        conditions.map((condition) => sql`(${condition})`),
        sql` OR `,
      )} LIMIT 1`,
    )
    if ((result as unknown as { rows: unknown[] }).rows.length > 0) {
      affectedTables.push(spec.key)
    }
  }
  if (affectedTables.length > 0) throw new PartialBackupConflictError(affectedTables)

  const artistReferences = [
    { key: 'recommendations', column: 'artistId', artistColumn: 'id' },
    { key: 'albumBlocks', column: 'artistId', artistColumn: 'id' },
    { key: 'artistBlocks', column: 'artistId', artistColumn: 'id' },
    { key: 'artistGenreAliases', column: 'mbid', artistColumn: 'mbid' },
  ] as const
  const referenced = artistReferences.filter((ref) => (backup.data[ref.key]?.length ?? 0) > 0)
  if (referenced.length === 0) return
  const artistRows = backup.data.artists ?? (await selectAll(tx, artists))
  const unresolved = referenced.filter((ref) => {
    const values = new Set(artistRows.map((row) => row[ref.artistColumn]))
    return backup.data[ref.key]?.some((row) => !values.has(row[ref.column]))
  })
  if (unresolved.length > 0) {
    throw new PartialBackupConflictError(
      unresolved.map((ref) => ref.key),
      `Backup has unresolved artist references in: ${unresolved.map((ref) => ref.key).join(', ')}`,
    )
  }
}

export async function copyDatabaseTables(
  source: Pick<OpsDb, 'select'>,
  target: OpsDb,
  options: { requireEmptyTarget?: boolean } = {},
): Promise<DatabaseCopyResult> {
  const tablesRestored: Record<string, number> = {}
  const mismatches: DatabaseCopyMismatch[] = []

  await target.transaction(async (tx) => {
    if (options.requireEmptyTarget) {
      const tableNames = RESTORE_ORDER.map((spec) => getTableName(spec.table)).sort()
      await tx.execute(
        sql`LOCK TABLE ${sql.join(
          tableNames.map((name) => sql.identifier(name)),
          sql`, `,
        )} IN SHARE ROW EXCLUSIVE MODE`,
      )
      await assertDatabaseCopyTargetEmpty(tx)
    }
    for (const spec of [...RESTORE_ORDER].reverse()) {
      await spec.clear(tx)
    }

    for (const spec of RESTORE_ORDER) {
      const sourceRows = await selectAll(source, spec.table)
      await spec.restore(tx, sourceRows)
      await spec.resetSequence(tx)
      tablesRestored[spec.key] = sourceRows.length

      const countResult = await tx.execute(
        sql`select count(*)::int n from ${sql.identifier(getTableName(spec.table))}`,
      )
      const targetCount = (countResult as unknown as { rows: { n: number }[] }).rows[0]?.n ?? 0
      if (targetCount !== sourceRows.length) {
        mismatches.push({ table: spec.key, source: sourceRows.length, target: targetCount })
        continue
      }

      const targetRows = await selectAll(tx, spec.table)
      if (tableHash(sourceRows) !== tableHash(targetRows)) {
        mismatches.push({
          table: spec.key,
          source: sourceRows.length,
          target: targetCount,
          contentDiffers: true,
        })
      }
    }
  })

  return { tablesRestored, mismatches }
}

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

  const warnings: string[] = []
  const legacyOidcTokenCount = Array.isArray(backup.data.oidcTokens)
    ? backup.data.oidcTokens.length
    : 0
  if (legacyOidcTokenCount > 0) {
    const record = legacyOidcTokenCount === 1 ? 'record' : 'records'
    warnings.push(`Ignored ${legacyOidcTokenCount} legacy OIDC token ${record}.`)
  }

  const { mismatch, fields } = detectEncryptionMismatch(backup)

  if (mismatch && !options.force) {
    warnings.push('Encryption key mismatch. Use force=true to restore anyway.')
    return {
      tablesRestored: {},
      warnings,
      encryptionMismatch: true,
      affectedEncryptedFields: fields,
    }
  }

  const tablesRestored: Record<string, number> = {}

  // Backward compatibility: map old subscriptionRuns to jobRuns format
  const backupData = backup.data as unknown as Record<string, unknown[]>
  if (backupData.subscriptionRuns?.length && !backup.data.jobRuns?.length) {
    backup.data.jobRuns = backupData.subscriptionRuns as Record<string, unknown>[]
  }

  // Wrap in a transaction so partial failures roll back cleanly.
  // Let errors bubble up to the caller so HTTP returns 500, not 200 with
  // an empty tablesRestored map and a warning the UI may miss.
  await db.transaction(async (tx) => {
    const includedSpecs = RESTORE_ORDER.filter((spec) => Array.isArray(backup.data[spec.key]))
    await checkRestoreSafety(tx, backup)

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

  return {
    tablesRestored,
    warnings,
    encryptionMismatch: mismatch,
    affectedEncryptedFields: mismatch ? fields : [],
  }
}
