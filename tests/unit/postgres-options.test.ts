import pg from 'pg'
import { describe, expect, it } from 'vitest'
import { postgresConnectionOptions } from '@/db/postgres-options'

const defaults = {
  max: 7,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 12_000,
  statement_timeout: 30_000,
  ssl: { rejectUnauthorized: true },
}

describe('Postgres connection options', () => {
  it.each(['a/b?c#d@e:f%g', '東京 🎵', '.', '..', 'a/../b', '%2F'])(
    'delivers the database identifier %j to the real driver exactly once',
    (database) => {
      const dsn = `postgresql://u%40ser:p%3Ass@localhost/${encodeURIComponent(database)}`
      const options = postgresConnectionOptions(dsn, defaults)
      const client = new pg.Client(options)
      expect(client.database).toBe(database)
      expect(client.user).toBe('u@ser')
      expect(client.password).toBe('p:ss')
      expect(options).not.toHaveProperty('connectionString')
    },
  )

  it.each(['.', '..', '%2e', '%2e%2e', 'a/../b', 'a/%2e%2e/b'])(
    'preserves raw URI path %s before URL normalization',
    (database) => {
      expect(
        new pg.Client(postgresConnectionOptions(`postgres://u:p@localhost/${database}`)).database,
      ).toBe(decodeURIComponent(database))
    },
  )

  it.each([
    'postgres://u:p@localhost',
    'postgres://u:p@localhost/',
    'postgres://u:p@localhost/db%name',
    'postgres://u:p@localhost/db%2F%name',
    'postgres://u:p@localhost/db name',
    'postgres://u:p@[::1]:5432/app',
    'postgres://u:p@localhost/app?host=%2Ftmp&application_name=digarr',
    'postgres://u:p@%2Ftmp/app',
    'socket:/tmp?db=app&encoding=UTF8',
    '/tmp app',
    'postgres://u:p@localhost/app?user=override&password=secret&options=-c%20search_path%3Dpublic',
  ])('preserves existing driver behavior for %s', (dsn) => {
    const baseline = new pg.Client({ ...defaults, connectionString: dsn })
    const client = new pg.Client(postgresConnectionOptions(dsn, defaults))
    for (const key of ['host', 'port', 'user', 'password', 'database', 'ssl'] as const) {
      expect(client[key]).toEqual(baseline[key])
    }
  })

  it.each([
    'ssl=no-verify',
    'ssl=0',
    'ssl=true',
    'ssl=false',
    'sslmode=disable',
    'sslmode=no-verify',
    'sslmode=verify-full',
    'sslnegotiation=direct',
  ])('preserves DSN TLS precedence for %s', (query) => {
    const dsn = `postgres://u:p@localhost/app?${query}`
    expect(new pg.Client(postgresConnectionOptions(dsn, defaults)).ssl).toEqual(
      new pg.Client({ ...defaults, connectionString: dsn }).ssl,
    )
  })

  it('preserves effective DSN session and query settings without accepting pool controls', () => {
    const options = postgresConnectionOptions(
      'postgres://u:p@localhost/app?statement_timeout=11&lock_timeout=12&idle_in_transaction_session_timeout=13&query_timeout=14&application_name=app&fallback_application_name=fallback&client_encoding=UTF8&options=-c%20search_path%3Dpublic&max=999&min=999&idleTimeoutMillis=1&connectionTimeoutMillis=1&Client=x&Promise=x&types=x&connection=x&stream=x&pipeline=1&binary=true&connectionString=postgres%3A%2F%2Fx%3Ay%40elsewhere%2Fwrong',
      defaults,
    )
    expect(options).toMatchObject({
      max: 7,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 12_000,
      statement_timeout: '11',
      lock_timeout: '12',
      idle_in_transaction_session_timeout: '13',
      query_timeout: '14',
      application_name: 'app',
      fallback_application_name: 'fallback',
      client_encoding: 'UTF8',
      options: '-c search_path=public',
    })
    for (const key of [
      'min',
      'Client',
      'Promise',
      'types',
      'connection',
      'stream',
      'pipeline',
      'binary',
      'connectionString',
    ]) {
      expect(options).not.toHaveProperty(key)
    }
    const client = new pg.Client(options)
    expect(client.database).toBe('app')
    expect(client).toHaveProperty('binary', false)
  })

  it.each([
    'postgres://u:private-password@localhost/%E0%A4',
    'postgres://u:private-password@localhost/%FF',
    'postgres://u:private-password@[invalid/app',
  ])('sanitizes parse and decode errors', (dsn) => {
    expect(() => postgresConnectionOptions(dsn)).toThrow(
      'Invalid PostgreSQL connection configuration',
    )
  })
})
