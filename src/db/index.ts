import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { buildDatabaseUrl, envConfig } from '@/config/env'
import * as schema from './schema'

const ssl =
  envConfig.dbSslMode === 'require'
    ? { rejectUnauthorized: true }
    : envConfig.dbSslMode === 'no-verify'
      ? { rejectUnauthorized: false }
      : undefined

const pool = new pg.Pool({
  connectionString: buildDatabaseUrl(),
  max: envConfig.dbPoolMax,
  connectionTimeoutMillis: envConfig.dbConnectTimeoutMs,
  ssl,
})

export const db = drizzle(pool, { schema })
export { pool }
export type Database = typeof db
