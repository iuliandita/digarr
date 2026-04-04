import { createHmac, timingSafeEqual } from 'node:crypto'
import { createMiddleware } from 'hono/factory'
import { envConfig } from '@/config/env'
import { getSession } from '@/core/sessions'
import type { HonoEnv } from '@/server/types'

/** Constant-time comparison that does not leak length via early return. */
function safeCompare(a: string, b: string): boolean {
  // HMAC both values to normalize length before comparing
  const key = 'digarr-safe-compare'
  const ha = createHmac('sha256', key).update(a).digest()
  const hb = createHmac('sha256', key).update(b).digest()
  return timingSafeEqual(ha, hb)
}

// Paths that never require authentication
const PUBLIC_PATHS = new Set([
  '/health',
  '/api/auth/status',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/oidc/login',
  '/api/auth/oidc/callback',
])

export function authGuard(hasUsers: () => Promise<boolean>) {
  return createMiddleware<HonoEnv>(async (c, next) => {
    // Skip auth for non-API paths (static assets, SPA routes), public API paths, and OAuth callbacks
    // Only the callback path is public (browser redirect from provider, no auth header).
    // Other OAuth paths (initiate, status, delete) need auth so userId is set on context.
    if (
      !c.req.path.startsWith('/api/') ||
      PUBLIC_PATHS.has(c.req.path) ||
      /^\/api\/auth\/oauth\/[^/]+\/callback$/.test(c.req.path)
    )
      return next()

    // Proxy auth already validated upstream -- skip token checks
    const proxyAuthed = c.get('proxyAuth')
    if (proxyAuthed) return next()

    // Extract token from Authorization header or query param (SSE fallback)
    const header = c.req.header('Authorization')
    let provided: string | undefined
    if (header?.startsWith('Bearer ')) {
      provided = header.slice(7)
    } else {
      const qp = c.req.query('token')
      if (qp) provided = qp
    }

    // Try session token first
    if (provided) {
      const session = await getSession(provided)
      if (session) {
        c.set('userId', session.userId)
        return next()
      }
    }

    // Fall back to legacy DIGARR_AUTH_TOKEN (read-only, first user, no admin)
    const legacyToken = envConfig.authToken
    if (legacyToken && provided && safeCompare(provided, legacyToken)) {
      console.warn(
        `[auth] DEPRECATED: Legacy token auth from ${c.req.header('x-forwarded-for') ?? 'direct'} -- no admin access, no per-user features. Migrate to user sessions.`,
      )
      // Assign userId=1 (first user) so downstream queries scope correctly
      // instead of matching NULL userId records
      c.set('userId', 1)
      return next()
    }

    // Auth is required if a legacy token is configured OR users have been registered
    const usersExist = await hasUsers()
    if (!legacyToken && !usersExist) {
      c.set('authSkipped', true)
      return next() // No auth configured at all
    }

    return c.json({ error: 'Unauthorized' }, 401)
  })
}
