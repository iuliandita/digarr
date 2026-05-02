import { createMiddleware } from 'hono/factory'
import { problem } from '@/server/helpers/problem'
import type { HonoEnv } from '@/server/types'

type RateLimitBucket = { count: number; resetAt: number }
type RateLimitStore = Map<string, RateLimitBucket>

const registry: RateLimitStore[] = []
let pruneInterval: ReturnType<typeof setInterval> | null = null

function ensurePruneStarted(): void {
  if (pruneInterval) return
  pruneInterval = setInterval(() => {
    const now = Date.now()
    for (const store of registry) {
      for (const [key, bucket] of store) {
        if (bucket.resetAt <= now) store.delete(key)
      }
    }
  }, 60_000)
  pruneInterval.unref?.()
}

/** Exposed for tests: clear the shared prune interval and registry. */
export function __shutdownRateLimiter(): void {
  if (pruneInterval) clearInterval(pruneInterval)
  pruneInterval = null
  registry.length = 0
}

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
 * All limiter instances share one prune interval via the module-level registry.
 */
export function rateLimiter(opts: { windowMs: number; max: number; keyPrefix?: string }) {
  const buckets: RateLimitStore = new Map()
  registry.push(buckets)
  ensurePruneStarted()

  return createMiddleware<HonoEnv>(async (c, next) => {
    // Use socket IP to prevent bypass via forged X-Forwarded-For headers.
    // Same approach as proxy-auth.ts getSocketIp().
    const ip = getSocketIp(c) ?? 'unknown'
    // Append the resolved userId to the bucket key when auth has already run.
    // Without this, every authenticated user behind a reverse proxy or shared
    // NAT shares one bucket and a single noisy account drains the budget for
    // everyone. Pre-auth limiters (login / register) leave userId undefined
    // so they keep the IP-only behaviour.
    const userId = c.get('userId')
    const principal = typeof userId === 'number' ? `${ip}|u${userId}` : ip
    const key = `${opts.keyPrefix ?? 'rl'}:${principal}`
    const now = Date.now()

    let bucket = buckets.get(key)
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + opts.windowMs }
      buckets.set(key, bucket)
    }

    bucket.count++

    const remaining = Math.max(0, opts.max - bucket.count)
    const resetEpoch = Math.ceil(bucket.resetAt / 1000)
    const windowSeconds = Math.ceil(opts.windowMs / 1000)

    // Legacy X-RateLimit-* headers stay for existing clients; the new
    // RateLimit-* set (IETF draft-ietf-httpapi-ratelimit-headers) is added
    // in parallel so forward-looking clients can rely on the standard.
    c.header('X-RateLimit-Limit', String(opts.max))
    c.header('X-RateLimit-Remaining', String(remaining))
    c.header('X-RateLimit-Reset', String(resetEpoch))
    c.header('RateLimit-Policy', `${opts.max};w=${windowSeconds}`)
    c.header('RateLimit-Limit', String(opts.max))
    c.header('RateLimit-Remaining', String(remaining))
    c.header('RateLimit-Reset', String(Math.max(0, Math.ceil((bucket.resetAt - now) / 1000))))

    if (bucket.count > opts.max) {
      const retryAfter = Math.max(0, Math.ceil((bucket.resetAt - now) / 1000))
      c.header('Retry-After', String(retryAfter))
      return problem(c, 'rate-limited', 'Too many requests', 429, undefined, { retryAfter })
    }

    await next()
  })
}
