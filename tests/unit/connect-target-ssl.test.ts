import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Capture the options the migration-target Pool is constructed with, without
// opening a real connection.
// Regular function (not arrow) so `new pg.Pool(...)` can construct it.
// biome-ignore lint/complexity/useArrowFunction: an arrow function is not constructable with `new`
const poolCtor = vi.fn(function (_opts: Record<string, unknown>) {
  return {
    query: vi.fn(async () => ({ rows: [] })),
    end: vi.fn(async () => {}),
  }
})

vi.mock('pg', () => ({ default: { Pool: poolCtor } }))

describe('connectTarget postgres pool hardening', () => {
  const prevSsl = process.env.DB_SSL_MODE
  const prevTimeout = process.env.DB_CONNECT_TIMEOUT_MS

  beforeEach(() => {
    poolCtor.mockClear()
    vi.resetModules()
  })
  afterEach(() => {
    if (prevSsl === undefined) delete process.env.DB_SSL_MODE
    else process.env.DB_SSL_MODE = prevSsl
    if (prevTimeout === undefined) delete process.env.DB_CONNECT_TIMEOUT_MS
    else process.env.DB_CONNECT_TIMEOUT_MS = prevTimeout
  })

  it('honors DB_SSL_MODE=require and always sets a connect timeout', async () => {
    process.env.DB_SSL_MODE = 'require'
    delete process.env.DB_CONNECT_TIMEOUT_MS
    const { connectTarget } = await import('@/db/connect')

    const conn = await connectTarget({
      backend: 'postgres',
      dsn: 'postgres://u:p@db.internal:5432/app',
    })
    await conn.close()

    expect(poolCtor).toHaveBeenCalledTimes(1)
    const opts = poolCtor.mock.calls[0]?.[0] ?? {}
    // SSL must be enforced so a full copy of user PII never traverses the wire
    // in plaintext when the operator asked for it.
    expect(opts.ssl).toEqual({ rejectUnauthorized: true })
    // A dead target must fail fast instead of hanging the request indefinitely.
    expect(typeof opts.connectionTimeoutMillis).toBe('number')
    expect(opts.connectionTimeoutMillis as number).toBeGreaterThan(0)
  })

  it('uses no-verify SSL when DB_SSL_MODE=no-verify', async () => {
    process.env.DB_SSL_MODE = 'no-verify'
    const { connectTarget } = await import('@/db/connect')

    const conn = await connectTarget({
      backend: 'postgres',
      dsn: 'postgres://u:p@db.internal:5432/app',
    })
    await conn.close()

    const opts = poolCtor.mock.calls[0]?.[0] ?? {}
    expect(opts.ssl).toEqual({ rejectUnauthorized: false })
  })
})

describe('Postgres pool identifier wiring', () => {
  it('passes exact identifiers and fixed limits to migration targets', async () => {
    const { connectTarget } = await import('@/db/connect')
    const conn = await connectTarget({
      backend: 'postgres',
      dsn: 'postgres://u:p@localhost/a%2Fb%3Fc?max=999&connectionString=postgres%3A%2F%2Fother%2Fwrong',
    })
    await conn.close()
    const opts = poolCtor.mock.calls.at(-1)?.[0] ?? {}
    expect(opts).toMatchObject({ database: 'a/b?c', max: 4 })
    expect(opts).not.toHaveProperty('connectionString')
  })

  it('passes exact identifiers and configured limits to the startup pool', async () => {
    const originalDsn = process.env.DATABASE_URL
    const originalMax = process.env.DB_POOL_MAX
    try {
      process.env.DATABASE_URL = 'postgres://u:p@localhost/%2e%2e?max=999'
      process.env.DB_POOL_MAX = '9'
      vi.resetModules()
      const { closeDb } = await import('@/db/index')
      await closeDb()
      const opts = poolCtor.mock.calls.at(-1)?.[0] ?? {}
      expect(opts).toMatchObject({ database: '..', max: 9, statement_timeout: 30_000 })
      expect(opts).not.toHaveProperty('connectionString')
    } finally {
      if (originalDsn === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = originalDsn
      if (originalMax === undefined) delete process.env.DB_POOL_MAX
      else process.env.DB_POOL_MAX = originalMax
      vi.resetModules()
    }
  })
})
