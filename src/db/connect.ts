import { existsSync, realpathSync } from 'node:fs'
import * as path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { sql } from 'drizzle-orm'
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator'
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite'
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator'
import pg from 'pg'
import { getPgliteDataDir } from '@/db/backend'
import * as schema from '@/db/schema'

const MIGRATIONS_FOLDER = path.join(process.cwd(), 'drizzle')

export type MigrationTargetSpec =
  | { backend: 'pglite'; path: string }
  | { backend: 'postgres'; dsn: string }

export interface TargetConnection {
  backend: 'pglite' | 'postgres'
  db: NodePgDatabase<typeof schema>
  runMigrations: () => Promise<void>
  ping: () => Promise<void>
  describe: () => string
  close: () => Promise<void>
}

function allowedPgliteRoot(): string {
  const override = process.env.DIGARR_MIGRATE_DATA_ROOT
  const root = override && override.length > 0 ? override : path.dirname(getPgliteDataDir())
  return existsSync(root) ? realpathSync(root) : path.resolve(root)
}

export function assertSafePglitePath(p: string): string {
  if (!path.isAbsolute(p)) throw new Error('PGlite path must be absolute')
  const root = allowedPgliteRoot()
  const resolved = path.resolve(p)
  // Resolve the parent only (the target dir need not exist yet; PGlite creates it).
  const parent = path.dirname(resolved)
  const realParent = existsSync(parent) ? realpathSync(parent) : path.resolve(parent)
  const realResolved = path.join(realParent, path.basename(resolved))
  const rel = path.relative(root, realResolved)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`PGlite path is outside the allowed data root (${root})`)
  }
  return realResolved
}

function maskDsn(dsn: string): string {
  try {
    const u = new URL(dsn)
    const userPart = u.username ? `${u.username}@` : ''
    return `${u.protocol}//${userPart}${u.host}${u.pathname}`
  } catch {
    return 'postgres://<unparseable-dsn>'
  }
}

export async function backendFingerprint(
  db: Pick<NodePgDatabase<typeof schema>, 'execute'>,
): Promise<string> {
  const res = await db.execute(
    sql`select system_identifier::text as sid, current_database() as db from pg_control_system()`,
  )
  const row = (res as unknown as { rows: { sid: string; db: string }[] }).rows[0]
  return `${row?.sid ?? 'unknown'}:${row?.db ?? 'unknown'}`
}

export async function connectTarget(spec: MigrationTargetSpec): Promise<TargetConnection> {
  if (spec.backend === 'pglite') {
    const abs = assertSafePglitePath(spec.path)
    const client = new PGlite(abs)
    const db = drizzlePglite(client, { schema }) as unknown as NodePgDatabase<typeof schema>
    return {
      backend: 'pglite',
      db,
      runMigrations: () => migratePglite(db as never, { migrationsFolder: MIGRATIONS_FOLDER }),
      ping: async () => {
        await db.execute(sql`select 1`)
      },
      describe: () => `PGlite file at ${abs}`,
      close: () => client.close(),
    }
  }

  const pool = new pg.Pool({ connectionString: spec.dsn, max: 4 })
  const db = drizzlePg(pool, { schema })
  return {
    backend: 'postgres',
    db,
    runMigrations: () => migratePg(db, { migrationsFolder: MIGRATIONS_FOLDER }),
    ping: async () => {
      await db.execute(sql`select 1`)
    },
    describe: () => maskDsn(spec.dsn),
    close: () => pool.end(),
  }
}
