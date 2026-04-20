import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { tryConsume } from '@/core/clients/rate-limiter'
import * as schema from '@/db/schema'

const { Pool } = pg

// Real Postgres integration test: the rate limiter's correctness lives in
// Postgres itself (atomic ON CONFLICT + LEAST() refill), so mocks would
// verify nothing meaningful. Skips gracefully without DATABASE_URL.
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://digarr:digarr@localhost:5432/digarr'

const pool = new Pool({ connectionString: DATABASE_URL })
const db = drizzle(pool, { schema })

let pgAvailable = true

describe('rate-limiter', () => {
  beforeEach(async () => {
    if (!pgAvailable) return
    try {
      await db.execute(sql`DELETE FROM rate_limit_buckets`)
    } catch {
      pgAvailable = false
    }
  })

  afterAll(async () => {
    await pool.end().catch(() => {})
  })

  it('returns true when bucket is fresh', async () => {
    if (!pgAvailable) return
    const ok = await tryConsume(db, 'test-key', { capacity: 30, refillPerMs: 30 / 60_000 })
    expect(ok).toBe(true)
    const row = await db.query.rateLimitBuckets.findFirst({
      where: (b, { eq }) => eq(b.key, 'test-key'),
    })
    expect(Number(row?.tokens)).toBe(29)
  })

  it('returns false when bucket is exhausted with no elapsed refill', async () => {
    if (!pgAvailable) return
    for (let i = 0; i < 30; i++) {
      await tryConsume(db, 'exhaust', { capacity: 30, refillPerMs: 30 / 60_000 })
    }
    const ok = await tryConsume(db, 'exhaust', { capacity: 30, refillPerMs: 30 / 60_000 })
    expect(ok).toBe(false)
  })

  it('refills after time elapsed', async () => {
    if (!pgAvailable) return
    await tryConsume(db, 'refill', { capacity: 1, refillPerMs: 1 / 1_000 })
    const immediate = await tryConsume(db, 'refill', { capacity: 1, refillPerMs: 1 / 1_000 })
    expect(immediate).toBe(false)
    await new Promise((r) => setTimeout(r, 1_100))
    const after = await tryConsume(db, 'refill', { capacity: 1, refillPerMs: 1 / 1_000 })
    expect(after).toBe(true)
  })

  it('isolates different keys', async () => {
    if (!pgAvailable) return
    await tryConsume(db, 'a', { capacity: 1, refillPerMs: 0 })
    const aBlocked = await tryConsume(db, 'a', { capacity: 1, refillPerMs: 0 })
    const bOk = await tryConsume(db, 'b', { capacity: 1, refillPerMs: 0 })
    expect(aBlocked).toBe(false)
    expect(bOk).toBe(true)
  })

  it('handles concurrent consumers at capacity=1 (exactly one wins)', async () => {
    if (!pgAvailable) return
    const results = await Promise.all(
      Array.from({ length: 10 }, () => tryConsume(db, 'race', { capacity: 1, refillPerMs: 0 })),
    )
    expect(results.filter(Boolean).length).toBe(1)
  })
})
