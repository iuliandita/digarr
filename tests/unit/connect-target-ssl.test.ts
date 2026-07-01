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
