import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTableColumns } from 'drizzle-orm'
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
  oauthTokens,
  oidcTokens,
  playlists,
  playlistTracks,
  recommendationBatches,
  recommendations,
  settings,
  subscriptionRuns,
  subscriptions,
  targets,
  users,
} from '@/db/schema'
import type { BackupFile, BackupOptions, OpsDb, RestoreOptions, RestoreResult } from './types'

function getAppVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8'))
    return pkg.version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

// biome-ignore lint/suspicious/noExplicitAny: drizzle table type is opaque
async function selectAll(db: OpsDb, table: any): Promise<Record<string, unknown>[]> {
  return db.select().from(table) as unknown as Record<string, unknown>[]
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
    subRunRows,
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
    selectAll(db, subscriptionRuns),
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
      subscriptionRuns: subRunRows,
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

// Table restore order respects FK dependencies
const RESTORE_ORDER: {
  key: keyof BackupFile['data']
  // biome-ignore lint/suspicious/noExplicitAny: drizzle table type
  table: any
}[] = [
  { key: 'settings', table: settings },
  { key: 'users', table: users },
  { key: 'artists', table: artists },
  { key: 'genres', table: genres },
  { key: 'artistMetadata', table: artistMetadata },
  { key: 'oauthTokens', table: oauthTokens },
  { key: 'oidcTokens', table: oidcTokens },
  { key: 'targets', table: targets },
  { key: 'subscriptions', table: subscriptions },
  { key: 'playlists', table: playlists },
  { key: 'recommendationBatches', table: recommendationBatches },
  { key: 'subscriptionRuns', table: subscriptionRuns },
  { key: 'recommendations', table: recommendations },
  { key: 'playlistTracks', table: playlistTracks },
]

// biome-ignore lint/suspicious/noExplicitAny: drizzle table type is opaque
function filterToSchemaColumns(table: any, row: Record<string, unknown>): Record<string, unknown> {
  const allowed = new Set(Object.keys(getTableColumns(table)))
  const filtered: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    if (allowed.has(key)) filtered[key] = value
  }
  return filtered
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

  for (const { key, table } of RESTORE_ORDER) {
    const rows = backup.data[key]
    if (!rows || !Array.isArray(rows) || rows.length === 0) continue

    try {
      for (const row of rows) {
        const safeRow = filterToSchemaColumns(table, row)
        // biome-ignore lint/suspicious/noExplicitAny: drizzle insert builder type is opaque
        await (db.insert(table).values(safeRow as never) as any).onConflictDoUpdate({
          target: table.id ?? table.mbid ?? table.slug ?? table.nameNormalized ?? table.token,
          set: safeRow,
        })
      }
      tablesRestored[key] = rows.length
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      warnings.push(`Failed to restore ${key}: ${msg}`)
    }
  }

  return {
    tablesRestored,
    warnings,
    encryptionMismatch: mismatch,
    affectedEncryptedFields: mismatch ? fields : [],
  }
}
