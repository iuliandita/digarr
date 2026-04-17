import { createHmac, timingSafeEqual } from 'node:crypto'
import { getCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import { envConfig } from '@/config/env'
import { getSession } from '@/core/sessions'
import { SESSION_COOKIE_NAME } from '@/server/middleware/session-cookie'
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
  '/api/setup/status',
  '/api/setup/complete',
  '/api/auth/status',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/oidc/login',
  '/api/auth/oidc/callback',
])

const OPTIONAL_AUTH_PATHS = new Set([
  '/api/setup/status',
  '/api/setup/complete',
  '/api/auth/status',
])

// Only SSE/audio flows are allowed to use query-param auth tokens.
const QUERY_TOKEN_PATHS = new Set(['/api/pipeline/events', '/api/preview/audio'])

export function authGuard(options: {
  hasUsers: () => Promise<boolean>
  isSetupComplete: () => Promise<boolean>
}) {
  return createMiddleware<HonoEnv>(async (c, next) => {
    const publicPath =
      !c.req.path.startsWith('/api/') ||
      PUBLIC_PATHS.has(c.req.path) ||
      /^\/api\/auth\/oauth\/[^/]+\/callback$/.test(c.req.path)

    // Skip auth for non-API paths (static assets, SPA routes), public API paths, and OAuth callbacks
    // Only the callback path is public (browser redirect from provider, no auth header).
    // Other OAuth paths (initiate, status, delete) need auth so userId is set on context.
    if (publicPath && !OPTIONAL_AUTH_PATHS.has(c.req.path)) return next()

    // Proxy auth already validated upstream - skip token checks
    const proxyAuthed = c.get('proxyAuth')
    if (proxyAuthed) return next()

    // Extract token from Authorization header, query param (SSE fallback), or
    // the httpOnly session cookie (set by proxy-auth / OIDC callback / login).
    // Header wins over cookie so the SPA's localStorage flow keeps working;
    // the cookie is the fallback for browser-only sessions.
    const header = c.req.header('Authorization')
    let provided: string | undefined
    if (header?.startsWith('Bearer ')) {
      provided = header.slice(7)
    } else {
      const qp = c.req.query('token')
      if (qp && QUERY_TOKEN_PATHS.has(c.req.path)) provided = qp
      if (!provided) {
        const cookieToken = getCookie(c, SESSION_COOKIE_NAME)
        if (cookieToken) provided = cookieToken
      }
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
        `[auth] DEPRECATED: Legacy token auth from ${c.req.header('x-forwarded-for') ?? 'direct'} - no admin access, no per-user features. Migrate to user sessions.`,
      )
      // Assign userId=1 (first user) so downstream queries scope correctly
      // instead of matching NULL userId records
      c.set('userId', 1)
      c.set('legacyTokenAuth', true)
      return next()
    }

    if (publicPath) return next()

    // Auth is required if a legacy token is configured OR users have been registered
    const [usersExist, setupComplete] = await Promise.all([
      options.hasUsers(),
      options.isSetupComplete(),
    ])
    if (!legacyToken && !usersExist && !setupComplete) {
      c.set('authSkipped', true)
      return next() // No auth configured at all
    }
    // Degenerate state: setup marked complete but no users exist. Indicates
    // orphaned DB state (admin record deleted while setup flag stayed true,
    // or an interrupted migration). Return 503 so ops can notice and re-run
    // setup, rather than 401 which would let callers retry indefinitely.
    if (!legacyToken && !usersExist && setupComplete) {
      return c.json({ error: 're-run setup', detail: 'admin record missing' }, 503)
    }

    return c.json({ error: 'Unauthorized' }, 401)
  })
}
