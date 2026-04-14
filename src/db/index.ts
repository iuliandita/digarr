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

// A db handle that can be either the top-level Database or an in-flight
// transaction. Query helpers that participate in caller-provided transactions
// should accept this type.
export type DbOrTx = Database | Parameters<Parameters<Database['transaction']>[0]>[0]
