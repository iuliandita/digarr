import { sql } from 'drizzle-orm'
import type { Database } from '@/db'
import { backendFingerprint, connectTarget, type MigrationTargetSpec } from '@/db/connect'
import { copyDatabaseTables } from './backup'

/** A known precondition failure (not a crash). `code` lets the HTTP layer map it
 *  to a meaningful status. Messages never contain credentials. */
export type MigrateErrorCode =
  | 'pipeline_running'
  | 'same_database'
  | 'target_not_empty'
  | 'encryption_mismatch'

export class MigrateBackendError extends Error {
  constructor(
    readonly code: MigrateErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'MigrateBackendError'
  }
}

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

export async function migrateBackend(input: MigrateBackendInput): Promise<MigrationReport> {
  const { sourceDb, target, isPipelineRunning, overwrite = false } = input

  if (isPipelineRunning()) {
    throw new MigrateBackendError(
      'pipeline_running',
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
      throw new MigrateBackendError(
        'same_database',
        'Target is the same database as the source. Choose a different target.',
      )
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
        throw new MigrateBackendError(
          'target_not_empty',
          'Target database is not empty. Re-run with overwrite=true to replace its contents.',
        )
      }
    }

    await conn.runMigrations()

    if (overwrite) {
      // Best-effort by design: this truncate runs outside the restore
      // transaction below. Both tables are excluded from migration (see
      // EXCLUDED_TABLES) and hold only ephemeral auth/rate-limit state, so a
      // failed restore leaving them empty on the target is harmless.
      await conn.db.execute(sql`truncate table sessions, rate_limit_buckets`)
    }

    if (isPipelineRunning()) {
      throw new MigrateBackendError(
        'pipeline_running',
        'A pipeline started during preflight. Aborting; the target is left empty.',
      )
    }

    const copy = await sourceDb.transaction(async (tx) => {
      await tx.execute(sql`set transaction isolation level repeatable read read only`)
      return copyDatabaseTables(tx, conn.db)
    })

    const verified = copy.mismatches.length === 0
    // A count mismatch leaves content unchecked, so contentVerified must require
    // verified too — otherwise a missing table reports intact content.
    const contentVerified = verified && !copy.mismatches.some((m) => m.contentDiffers)
    return {
      ok: verified,
      verified,
      contentVerified,
      targetBackend: conn.backend,
      targetDescription: conn.describe(),
      tablesMigrated: copy.tablesRestored,
      excludedTables: [...EXCLUDED_TABLES],
      mismatches: copy.mismatches,
      targetEnvHint: envHint(target),
    }
  } finally {
    await conn.close()
  }
}
