import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'

let cachedDotEnv: Record<string, string> | null = null

function readDotEnv(): Record<string, string> {
  if (cachedDotEnv) return cachedDotEnv

  const envPath = join(process.cwd(), '.env')
  if (!existsSync(envPath)) {
    cachedDotEnv = {}
    return cachedDotEnv
  }

  const values: Record<string, string> = {}
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) continue
    const key = match[1]
    let value = match[2] ?? ''
    value = value.trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (key) values[key] = value
  }

  cachedDotEnv = values
  return values
}

function getSetting(name: string): string | undefined {
  return process.env[name] ?? readDotEnv()[name]
}

function resolveBaseDatabaseUrl(): string | undefined {
  const databaseUrl = getSetting('DATABASE_URL')
  if (databaseUrl) return databaseUrl

  const host = getSetting('DB_HOST')
  const user = getSetting('DB_USER')
  const dbName = getSetting('DB_NAME')
  if (!host || !user || !dbName) return undefined

  const port = getSetting('DB_PORT') ?? '5432'
  const password = getSetting('DB_PASS')
  const auth = password ? `${user}:${encodeURIComponent(password)}` : user
  return `postgresql://${auth}@${host}:${port}/${dbName}`
}

export function getPlaywrightDatabaseUrl(): string | undefined {
  const baseUrl = resolveBaseDatabaseUrl()
  if (!baseUrl) return undefined

  const url = new URL(baseUrl)
  const dbName = url.pathname.replace(/^\//, '')
  if (!dbName) return undefined
  url.pathname = `/${dbName}_playwright`
  return url.toString()
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

export async function resetPlaywrightDatabase(): Promise<string | undefined> {
  const databaseUrl = getPlaywrightDatabaseUrl()
  if (!databaseUrl) return undefined

  const targetUrl = new URL(databaseUrl)
  const databaseName = targetUrl.pathname.replace(/^\//, '')
  if (!databaseName) return undefined

  const adminUrl = new URL(databaseUrl)
  adminUrl.pathname = '/postgres'

  const client = new pg.Client({ connectionString: adminUrl.toString() })
  await client.connect()

  try {
    await client.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [databaseName],
    )
    await client.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`)
    await client.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`)
  } finally {
    await client.end()
  }

  return databaseUrl
}
