import { PGlite } from '@electric-sql/pglite'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres'
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite'
import pg from 'pg'
import { buildDatabaseUrl, envConfig } from '@/config/env'
import {
  applyPgliteStatementTimeout,
  detectPartialPostgresConfig,
  getPgliteDataDir,
  resolveDbBackend,
} from './backend'
import * as schema from './schema'

export const dbBackend = resolveDbBackend()

// Database is pinned to the node-postgres type. Both drivers expose the same
// drizzle query API for our pg-core schema, so the PGlite instance is cast to
// this type — every downstream call site keeps compiling unchanged.
export type Database = NodePgDatabase<typeof schema>
export type DbOrTx = Database | Parameters<Parameters<Database['transaction']>[0]>[0]

let pgPool: pg.Pool | null = null
let pgliteClient: PGlite | null = null

function buildPostgres(): Database {
  const ssl =
    envConfig.dbSslMode === 'require'
      ? { rejectUnauthorized: true }
      : envConfig.dbSslMode === 'no-verify'
        ? { rejectUnauthorized: false }
        : undefined

  pgPool = new pg.Pool({
    connectionString: buildDatabaseUrl(),
    max: envConfig.dbPoolMax ?? 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: envConfig.dbConnectTimeoutMs,
    // Cap any single query at 30s server-side. Protects against runaway
    // reports/hygiene scans hogging a connection.
    statement_timeout: 30_000,
    ssl,
  })
  return drizzlePg(pgPool, { schema })
}

function buildPglite(): Database {
  // In tests with no configured path, stay fully in-memory to avoid touching disk.
  const inMemory = process.env.VITEST && !envConfig.dbPath
  pgliteClient = inMemory ? new PGlite() : new PGlite(getPgliteDataDir())
  // FIFO-queued ahead of every app query, so the cap is live from the first one.
  void applyPgliteStatementTimeout(pgliteClient)
  return drizzlePglite(pgliteClient, { schema }) as unknown as Database
}

export const db: Database = dbBackend === 'postgres' ? buildPostgres() : buildPglite()

// Loud, greppable boot log so an operator who accidentally dropped their DSN
// (and silently fell back to an empty PGlite file) sees it immediately.
console.log(
  dbBackend === 'postgres'
    ? '[db] backend=postgres (DSN configured)'
    : '[db] backend=pglite (no DATABASE_URL/DB_HOST configured)',
)

// A half-set Postgres config (e.g. DB_HOST without DB_NAME) silently boots an
// empty embedded PGlite instead. Shout so the operator does not run on the
// wrong database without noticing.
const partialPg = detectPartialPostgresConfig()
if (partialPg) {
  console.warn(
    `[db] WARNING: partial Postgres config (set: ${partialPg.present.join(', ')}; ` +
      `missing: ${partialPg.missing.join(', ')}) -- falling back to embedded PGlite. ` +
      'Your Postgres database is NOT in use. Set DATABASE_URL, or all of DB_HOST, ' +
      'DB_USER, DB_NAME, to connect to Postgres.',
  )
}

/** The pg Pool, or null under PGlite (in-process, no socket to wait on). */
export const pool: pg.Pool | null = pgPool

/** Close the active backend, flushing PGlite to disk. Called on shutdown. */
export async function closeDb(): Promise<void> {
  if (pgPool) await pgPool.end()
  if (pgliteClient) await pgliteClient.close()
}
