import type { PoolConfig } from 'pg'
import { type ConnectionOptions, parse, toClientConfig } from 'pg-connection-string'

const CONNECTION_KEYS = [
  'host',
  'port',
  'user',
  'password',
  'database',
  'ssl',
  'sslnegotiation',
  'replication',
  'options',
  'client_encoding',
  'application_name',
  'fallback_application_name',
  'statement_timeout',
  'lock_timeout',
  'idle_in_transaction_session_timeout',
  'query_timeout',
] as const

export function postgresConnectionOptions(dsn: string, defaults: PoolConfig = {}): PoolConfig {
  try {
    const parsed = parse(dsn)
    // Match the driver's literal-percent correction before recovering unnormalized paths.
    const pathInput = / |%[^a-f0-9]|%[a-f0-9][^a-f0-9]/i.test(dsn)
      ? encodeURI(dsn).replace(/%25(\d\d)/g, '%$1')
      : dsn
    const rawPath = /^postgres(?:ql)?:\/\/[^/?#]*(?:\/([^?#]*))?/i.exec(pathInput)?.[1]
    if (rawPath) parsed.database = decodeURIComponent(rawPath)
    const selected: ConnectionOptions = { host: parsed.host, database: parsed.database }
    for (const key of CONNECTION_KEYS) {
      if (Object.hasOwn(parsed, key)) Object.assign(selected, { [key]: parsed[key] })
    }
    // The typed converter omits string SSL modes supported by pg itself.
    if (selected.ssl === 'no-verify') selected.ssl = { rejectUnauthorized: false }
    const options = { ...defaults, ...toClientConfig(selected) }
    if (typeof selected.ssl === 'string') {
      options.ssl = selected.ssl as unknown as PoolConfig['ssl']
    }
    delete options.connectionString
    return options
  } catch {
    throw new Error('Invalid PostgreSQL connection configuration')
  }
}
