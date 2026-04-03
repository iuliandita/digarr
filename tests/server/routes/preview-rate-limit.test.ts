// @vitest-environment node
import { describe, expect, it } from 'vitest'

describe('preview proxy rate limiting', () => {
  it('rateLimiter middleware is importable and configurable', async () => {
    const { rateLimiter } = await import('@/server/middleware/rate-limit')
    const mw = rateLimiter({ windowMs: 60_000, max: 30, keyPrefix: 'preview' })
    expect(mw).toBeDefined()
    expect(typeof mw).toBe('function')
  })
})
