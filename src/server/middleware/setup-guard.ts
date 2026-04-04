import type { Context, Next } from 'hono'

// Paths exempt from the setup-complete check (pre-setup accessible)
const SETUP_EXEMPT = new Set([
  '/api/setup',
  '/api/setup/status',
  '/api/setup/lidarr',
  '/api/setup/discover',
  '/api/setup/complete',
  '/health',
])

// Prefixes exempt from setup check (auth must work before setup completes)
const SETUP_EXEMPT_PREFIXES = ['/api/auth/', '/api/settings/test/'] as const

export function setupGuard(isSetupComplete: () => Promise<boolean>) {
  return async (c: Context, next: Next) => {
    const path = c.req.path
    if (SETUP_EXEMPT.has(path) || SETUP_EXEMPT_PREFIXES.some((p) => path.startsWith(p))) {
      return next()
    }
    if (path.startsWith('/api/')) {
      const complete = await isSetupComplete()
      if (!complete) {
        return c.json({ error: 'Setup not complete', redirect: '/setup' }, 403)
      }
    }
    return next()
  }
}
