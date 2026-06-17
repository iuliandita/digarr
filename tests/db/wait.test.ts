// @vitest-environment node
import type { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { isRetryableConnectionError, waitForDatabase } from '@/db/wait'

function pgError(code: string, message = 'boom') {
  const e = new Error(message) as Error & { code: string }
  e.code = code
  return e
}

// Pool whose `query` throws the supplied errors in order, then succeeds.
function poolFailingThenSucceeding(errors: unknown[]) {
  let i = 0
  return {
    query: vi.fn(async () => {
      if (i < errors.length) throw errors[i++]
      return { rows: [{ '?column?': 1 }] }
    }),
  }
}

describe('isRetryableConnectionError', () => {
  it('classifies 57P03 (cannot_connect_now) as retryable', () => {
    expect(isRetryableConnectionError(pgError('57P03'))).toBe(true)
  })

  it('classifies connection_failure (08006) as retryable', () => {
    expect(isRetryableConnectionError(pgError('08006'))).toBe(true)
  })

  it('classifies ECONNREFUSED as retryable', () => {
    expect(isRetryableConnectionError(pgError('ECONNREFUSED'))).toBe(true)
  })

  it('does not classify auth failure (28P01) as retryable', () => {
    expect(isRetryableConnectionError(pgError('28P01'))).toBe(false)
  })

  it('does not classify non-error or codeless values', () => {
    expect(isRetryableConnectionError(null)).toBe(false)
    expect(isRetryableConnectionError(undefined)).toBe(false)
    expect(isRetryableConnectionError('nope')).toBe(false)
    expect(isRetryableConnectionError({})).toBe(false)
    // numeric code (not a string) must not match
    expect(isRetryableConnectionError({ code: 57_003 })).toBe(false)
  })
})

describe('waitForDatabase', () => {
  it('resolves on the first successful connection without sleeping', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }) }
    const sleepFn = vi.fn().mockResolvedValue(undefined)
    await waitForDatabase(pool as unknown as Pool, { sleepFn })
    expect(pool.query).toHaveBeenCalledTimes(1)
    expect(pool.query).toHaveBeenCalledWith('SELECT 1')
    expect(sleepFn).not.toHaveBeenCalled()
  })

  it('retries transient failures with exponential backoff then succeeds', async () => {
    const pool = poolFailingThenSucceeding([
      pgError('57P03', 'the database system is not yet accepting connections'),
      pgError('ECONNREFUSED'),
    ])
    const sleepFn = vi.fn().mockResolvedValue(undefined)
    await waitForDatabase(pool as unknown as Pool, {
      sleepFn,
      initialDelayMs: 10,
      maxDelayMs: 40,
    })
    expect(pool.query).toHaveBeenCalledTimes(3)
    expect(sleepFn).toHaveBeenCalledTimes(2)
    expect(sleepFn).toHaveBeenNthCalledWith(1, 10)
    expect(sleepFn).toHaveBeenNthCalledWith(2, 20)
  })

  it('caps the backoff at maxDelayMs', async () => {
    const pool = poolFailingThenSucceeding([
      pgError('57P03'),
      pgError('57P03'),
      pgError('57P03'),
      pgError('57P03'),
    ])
    const sleepFn = vi.fn().mockResolvedValue(undefined)
    await waitForDatabase(pool as unknown as Pool, {
      sleepFn,
      initialDelayMs: 10,
      maxDelayMs: 40,
    })
    expect(pool.query).toHaveBeenCalledTimes(5)
    expect(sleepFn).toHaveBeenCalledTimes(4)
    expect(sleepFn).toHaveBeenNthCalledWith(1, 10)
    expect(sleepFn).toHaveBeenNthCalledWith(2, 20)
    expect(sleepFn).toHaveBeenNthCalledWith(3, 40)
    expect(sleepFn).toHaveBeenNthCalledWith(4, 40)
  })

  it('uses the default 1s/30s backoff when no delays are provided', async () => {
    const pool = poolFailingThenSucceeding([pgError('57P03')])
    const sleepFn = vi.fn().mockResolvedValue(undefined)
    await waitForDatabase(pool as unknown as Pool, { sleepFn })
    expect(sleepFn).toHaveBeenNthCalledWith(1, 1000)
  })

  it('propagates non-retryable errors immediately without sleeping', async () => {
    const pool = {
      query: vi.fn().mockRejectedValue(pgError('28P01', 'password authentication failed')),
    }
    const sleepFn = vi.fn().mockResolvedValue(undefined)
    await expect(waitForDatabase(pool as unknown as Pool, { sleepFn })).rejects.toThrow(
      'password authentication failed',
    )
    expect(pool.query).toHaveBeenCalledTimes(1)
    expect(sleepFn).not.toHaveBeenCalled()
  })
})
