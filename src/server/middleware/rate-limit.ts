import { createMiddleware } from 'hono/factory'
import type { HonoEnv } from '@/server/types'

type RateLimitBucket = { count: number; resetAt: number }

/** Extract socket-level IP (not forgeable headers). Mirrors proxy-auth.ts. */
function getSocketIp(c: { env?: unknown }): string | null {
  const env = c.env as Record<string, unknown> | undefined
  const bunAddr = env?.remoteAddress
  if (typeof bunAddr === 'string') return bunAddr
  const incoming = env?.incoming as { socket?: { remoteAddress?: string } } | undefined
  const nodeAddr = incoming?.socket?.remoteAddress
  if (typeof nodeAddr === 'string') return nodeAddr
  return null
}

/**
 * Simple in-memory rate limiter keyed by client IP.
 * Not shared across processes - sufficient for single-process deployments.
 */
export function rateLimiter(opts: { windowMs: number; max: number; keyPrefix?: string }) {
  const buckets = new Map<string, RateLimitBucket>()

  // Prune expired buckets every 60s to avoid unbounded growth
  setInterval(() => {
    const now = Date.now()
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key)
    }
  }, 60_000).unref()

  return createMiddleware<HonoEnv>(async (c, next) => {
    // Use socket IP to prevent bypass via forged X-Forwarded-For headers.
    // Same approach as proxy-auth.ts getSocketIp().
    const ip = getSocketIp(c) ?? 'unknown'
    const key = `${opts.keyPrefix ?? 'rl'}:${ip}`
    const now = Date.now()

    let bucket = buckets.get(key)
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + opts.windowMs }
      buckets.set(key, bucket)
    }

    bucket.count++

    c.header('X-RateLimit-Limit', String(opts.max))
    c.header('X-RateLimit-Remaining', String(Math.max(0, opts.max - bucket.count)))
    c.header('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)))

    if (bucket.count > opts.max) {
      return c.json({ error: 'Too many requests' }, 429)
    }

    await next()
  })
}
