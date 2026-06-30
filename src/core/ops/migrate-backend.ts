import { createHash } from 'node:crypto'
import { getTableName, sql } from 'drizzle-orm'
import type { AnyPgTable } from 'drizzle-orm/pg-core'
import type { Database } from '@/db'
import { backendFingerprint, connectTarget, type MigrationTargetSpec } from '@/db/connect'
import { BACKUP_TABLE_BY_KEY, createBackup, restoreBackup } from './backup'

export interface MigrateBackendInput {
  sourceDb: Database
  target: MigrationTargetSpec
  isPipelineRunning: () => boolean
  overwrite?: boolean
}

export interface MigrationReport {
  ok: boolean
  verified: boolean
  contentVerified: boolean
  targetBackend: 'pglite' | 'postgres'
  targetDescription: string
  tablesMigrated: Record<string, number>
  excludedTables: string[]
  mismatches: { table: string; source: number; target: number; contentDiffers?: boolean }[]
  targetEnvHint: string
}

const EXCLUDED_TABLES = ['sessions', 'rateLimitBuckets'] as const

function envHint(target: MigrationTargetSpec): string {
  if (target.backend === 'pglite') {
    return `Unset DATABASE_URL/DB_HOST and set DB_PATH=${target.path}, then restart.`
  }
  return 'Set DATABASE_URL to the PostgreSQL connection string you entered above, then restart.'
}

function canonical(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString()
  if (Array.isArray(v)) return v.map(canonical)
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>)
        .sort()
        .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
    )
  }
  return v
}

function tableHash(rows: Record<string, unknown>[]): string {
  const canon = rows.map((r) => JSON.stringify(canonical(r)))
  canon.sort()
  return createHash('sha256').update(canon.join('\n')).digest('hex')
}

export async function migrateBackend(input: MigrateBackendInput): Promise<MigrationReport> {
  const { sourceDb, target, isPipelineRunning, overwrite = false } = input

  if (isPipelineRunning()) {
    throw new Error(
      'Cannot migrate while a pipeline is running. Wait for it to finish and disable schedules first.',
    )
  }

  const conn = await connectTarget(target)
  try {
    await conn.ping()

    const [srcFp, tgtFp] = await Promise.all([
      backendFingerprint(sourceDb),
      backendFingerprint(conn.db),
    ])
    if (srcFp === tgtFp) {
      throw new Error('Target is the same database as the source. Choose a different target.')
    }

    const tableList = await conn.db.execute(
      sql`select table_name from information_schema.tables where table_schema = 'public'`,
    )
    const present = new Set(
      (tableList as unknown as { rows: { table_name: string }[] }).rows.map((r) => r.table_name),
    )
    if (present.has('users')) {
      const cnt = await conn.db.execute(sql`select count(*)::int n from users`)
      const userCount = (cnt as unknown as { rows: { n: number }[] }).rows[0]?.n ?? 0
      if (userCount > 0 && !overwrite) {
        throw new Error(
          'Target database is not empty. Re-run with overwrite=true to replace its contents.',
        )
      }
    }

    await conn.runMigrations()

    if (overwrite) {
      await conn.db.execute(sql`truncate table sessions, rate_limit_buckets`)
    }

    if (isPipelineRunning()) {
      throw new Error('A pipeline started during preflight. Aborting; the target is left empty.')
    }

    const backup = await sourceDb.transaction(async (tx) => {
      await tx.execute(sql`set transaction isolation level repeatable read read only`)
      return createBackup(tx, { includeCaches: true, full: true })
    })

    const restore = await restoreBackup(conn.db, backup, {})

    const targetBackup = await createBackup(conn.db, { includeCaches: true, full: true })
    const mismatches: MigrationReport['mismatches'] = []
    for (const [key, rows] of Object.entries(backup.data)) {
      if (!Array.isArray(rows)) continue
      const table = BACKUP_TABLE_BY_KEY[key as keyof typeof BACKUP_TABLE_BY_KEY]
      if (!table) continue
      const got = await conn.db.execute(
        sql`select count(*)::int n from ${sql.identifier(getTableName(table as AnyPgTable))}`,
      )
      const targetCount = (got as unknown as { rows: { n: number }[] }).rows[0]?.n ?? 0
      if (targetCount !== rows.length) {
        mismatches.push({ table: key, source: rows.length, target: targetCount })
        continue
      }
      const tgtRows =
        (targetBackup.data[key as keyof typeof targetBackup.data] as Record<string, unknown>[]) ??
        []
      if (tableHash(rows) !== tableHash(tgtRows)) {
        mismatches.push({
          table: key,
          source: rows.length,
          target: targetCount,
          contentDiffers: true,
        })
      }
    }

    const verified = mismatches.length === 0
    const contentVerified = !mismatches.some((m) => m.contentDiffers)
    return {
      ok: verified,
      verified,
      contentVerified,
      targetBackend: conn.backend,
      targetDescription: conn.describe(),
      tablesMigrated: restore.tablesRestored,
      excludedTables: [...EXCLUDED_TABLES],
      mismatches,
      targetEnvHint: envHint(target),
    }
  } finally {
    await conn.close()
  }
}
