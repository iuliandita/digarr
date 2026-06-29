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
