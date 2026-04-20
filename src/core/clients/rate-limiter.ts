import { sql } from 'drizzle-orm'
import type { Database } from '@/db'

export interface RateLimitConfig {
  capacity: number
  refillPerMs: number
}

// Atomic token-bucket consume. Refill and decrement happen in the same SQL
// statement so concurrent consumers race safely on the row lock.
export async function tryConsume(
  db: Database,
  key: string,
  config: RateLimitConfig,
): Promise<boolean> {
  const capacity = config.capacity
  const refillPerMs = config.refillPerMs

  const result = await db.execute(sql`
    INSERT INTO rate_limit_buckets (key, tokens, last_refill_at)
    VALUES (${key}, ${capacity - 1}, now())
    ON CONFLICT (key) DO UPDATE
    SET
      tokens = LEAST(
        ${capacity}::numeric,
        rate_limit_buckets.tokens
          + ${refillPerMs}::numeric
            * EXTRACT(EPOCH FROM (now() - rate_limit_buckets.last_refill_at)) * 1000
      ) - 1,
      last_refill_at = now()
    WHERE LEAST(
      ${capacity}::numeric,
      rate_limit_buckets.tokens
        + ${refillPerMs}::numeric
          * EXTRACT(EPOCH FROM (now() - rate_limit_buckets.last_refill_at)) * 1000
    ) >= 1
    RETURNING tokens
  `)

  const rows = (result as unknown as { rows?: unknown[] }).rows ?? (result as unknown as unknown[])
  return Array.isArray(rows) ? rows.length > 0 : false
}
