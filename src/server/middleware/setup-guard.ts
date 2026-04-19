import type { Context, Next } from 'hono'

// Paths exempt from the setup-complete check (pre-setup accessible)
const SETUP_EXEMPT = new Set([
  '/api/v1/setup',
  '/api/v1/setup/status',
  '/api/v1/setup/lidarr',
  '/api/v1/setup/discover',
  '/api/v1/setup/complete',
  '/health',
])

// Prefixes exempt from setup check (auth must work before setup completes)
const SETUP_EXEMPT_PREFIXES = ['/api/v1/auth/'] as const

export function setupGuard(isSetupComplete: () => Promise<boolean>) {
  return async (c: Context, next: Next) => {
    const path = c.req.path
    if (SETUP_EXEMPT.has(path) || SETUP_EXEMPT_PREFIXES.some((p) => path.startsWith(p))) {
      return next()
    }
    if (path.startsWith('/api/v1/')) {
      const complete = await isSetupComplete()
      if (!complete) {
        return c.json({ error: 'Setup not complete', redirect: '/setup' }, 403)
      }
    }
    return next()
  }
}
