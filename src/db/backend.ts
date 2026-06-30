import { join } from 'node:path'
import { envConfig } from '@/config/env'

export type DbBackend = 'postgres' | 'pglite'

/**
 * Postgres when an external connection is configured (full DSN, or host+user+name);
 * otherwise the embedded PGlite file backend. Presence of a DSN is the only switch.
 */
export function resolveDbBackend(): DbBackend {
  if (envConfig.databaseUrl) return 'postgres'
  if (envConfig.dbHost && envConfig.dbUser && envConfig.dbName) return 'postgres'
  return 'pglite'
}

/** Directory PGlite stores its data files in. Container deployments set DB_PATH=/app/data. */
export function getPgliteDataDir(): string {
  return envConfig.dbPath ?? join(process.cwd(), 'data')
}

/**
 * Detect a half-configured Postgres setup that silently fell back to PGlite: an
 * operator set some of DB_HOST/DB_USER/DB_NAME but not enough to resolve a DSN,
 * so their Postgres database is NOT being used. Returns null when the boot is a
 * clean PGlite default (no Postgres vars) or a complete Postgres config.
 */
/** Server-side cap on any single query, matching the Postgres pool's statement_timeout. */
export const PGLITE_STATEMENT_TIMEOUT_MS = 30_000

/**
 * Apply the query cap to a PGlite session. PGlite is in-process single-threaded
 * WASM Postgres, so a runaway query freezes the event loop and trips k8s liveness;
 * the timeout aborts it at the next interrupt point. PGlite serializes operations
 * FIFO, so issuing this right after construction lands it ahead of all app queries.
 */
export function applyPgliteStatementTimeout(client: {
  exec: (query: string) => Promise<unknown>
}): Promise<unknown> {
  const setTimeoutSql = `SET statement_timeout = ${PGLITE_STATEMENT_TIMEOUT_MS}`
  return client.exec(setTimeoutSql)
}

export function detectPartialPostgresConfig(): { present: string[]; missing: string[] } | null {
  if (resolveDbBackend() === 'postgres') return null
  const fields: ReadonlyArray<[string, string | undefined]> = [
    ['DB_HOST', envConfig.dbHost],
    ['DB_USER', envConfig.dbUser],
    ['DB_NAME', envConfig.dbName],
  ]
  const present = fields.filter(([, v]) => v).map(([k]) => k)
  if (present.length === 0) return null
  const missing = fields.filter(([, v]) => !v).map(([k]) => k)
  return { present, missing }
}
