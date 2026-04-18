// @vitest-environment node
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { __shutdownRateLimiter, rateLimiter } from '@/server/middleware/rate-limit'

// The limiter keys off socket-level IP to defeat forged X-Forwarded-For.
// Hono's Request interface lets tests inject `c.env.remoteAddress` via the
// second arg to app.request() so we can simulate distinct clients.
function buildApp(mw: ReturnType<typeof rateLimiter>) {
  const app = new Hono<{ Bindings: { remoteAddress?: string } }>()
  app.use('*', mw)
  app.get('/', (c) => c.text('ok'))
  return app
}

const env = (ip: string) => ({ remoteAddress: ip })

describe('rateLimiter', () => {
  afterEach(() => {
    __shutdownRateLimiter()
  })

  it('429s on burst past max for a single IP', async () => {
    const app = buildApp(rateLimiter({ max: 3, windowMs: 60_000, keyPrefix: 'burst' }))
    for (let i = 0; i < 3; i++) {
      const r = await app.request('/', {}, env('1.1.1.1'))
      expect(r.status).toBe(200)
    }
    const over = await app.request('/', {}, env('1.1.1.1'))
    expect(over.status).toBe(429)
    expect(await over.json()).toEqual({ error: 'Too many requests' })
  })

  it('X-RateLimit-Remaining decrements per call', async () => {
    const app = buildApp(rateLimiter({ max: 5, windowMs: 60_000, keyPrefix: 'rem' }))
    const r1 = await app.request('/', {}, env('2.2.2.2'))
    expect(r1.headers.get('X-RateLimit-Remaining')).toBe('4')
    expect(r1.headers.get('X-RateLimit-Limit')).toBe('5')
    const r2 = await app.request('/', {}, env('2.2.2.2'))
    expect(r2.headers.get('X-RateLimit-Remaining')).toBe('3')
  })

  it('emits IETF-standard RateLimit-* headers alongside legacy', async () => {
    const app = buildApp(rateLimiter({ max: 10, windowMs: 60_000, keyPrefix: 'ietf' }))
    const r = await app.request('/', {}, env('3.3.3.3'))
    expect(r.headers.get('RateLimit-Limit')).toBe('10')
    expect(r.headers.get('RateLimit-Remaining')).toBe('9')
    expect(r.headers.get('RateLimit-Policy')).toBe('10;w=60')
  })

  it('429 response carries Retry-After header', async () => {
    const app = buildApp(rateLimiter({ max: 1, windowMs: 60_000, keyPrefix: 'retry' }))
    await app.request('/', {}, env('4.4.4.4'))
    const r = await app.request('/', {}, env('4.4.4.4'))
    expect(r.status).toBe(429)
    const retryAfter = r.headers.get('Retry-After')
    expect(retryAfter).not.toBeNull()
    expect(Number.parseInt(retryAfter ?? '', 10)).toBeGreaterThan(0)
  })

  it('window reset allows fresh requests after expiry', async () => {
    vi.useFakeTimers()
    try {
      const app = buildApp(rateLimiter({ max: 1, windowMs: 60_000, keyPrefix: 'reset' }))
      await app.request('/', {}, env('5.5.5.5'))
      const blocked = await app.request('/', {}, env('5.5.5.5'))
      expect(blocked.status).toBe(429)
      vi.advanceTimersByTime(61_000)
      const fresh = await app.request('/', {}, env('5.5.5.5'))
      expect(fresh.status).toBe(200)
    } finally {
      vi.useRealTimers()
    }
  })

  it('isolates buckets across distinct socket IPs', async () => {
    const app = buildApp(rateLimiter({ max: 1, windowMs: 60_000, keyPrefix: 'sep' }))
    const a1 = await app.request('/', {}, env('10.0.0.1'))
    expect(a1.status).toBe(200)
    const b1 = await app.request('/', {}, env('10.0.0.2'))
    expect(b1.status).toBe(200)
    const a2 = await app.request('/', {}, env('10.0.0.1'))
    expect(a2.status).toBe(429)
    const b2 = await app.request('/', {}, env('10.0.0.2'))
    expect(b2.status).toBe(429)
  })

  it('separate keyPrefix limiters do not share state', async () => {
    const a = rateLimiter({ max: 1, windowMs: 60_000, keyPrefix: 'A' })
    const b = rateLimiter({ max: 1, windowMs: 60_000, keyPrefix: 'B' })
    const appA = buildApp(a)
    const appB = buildApp(b)
    await appA.request('/', {}, env('7.7.7.7')) // spends A's quota
    const onB = await appB.request('/', {}, env('7.7.7.7'))
    expect(onB.status).toBe(200)
  })

  it('falls back to "unknown" bucket when no socket IP is available', async () => {
    const app = buildApp(rateLimiter({ max: 2, windowMs: 60_000, keyPrefix: 'unk' }))
    // No env argument -> getSocketIp returns null -> key = "unk:unknown".
    const r1 = await app.request('/')
    expect(r1.status).toBe(200)
    const r2 = await app.request('/')
    expect(r2.status).toBe(200)
    const r3 = await app.request('/')
    expect(r3.status).toBe(429)
  })
})
