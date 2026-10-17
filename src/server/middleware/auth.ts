import { createHmac, timingSafeEqual } from 'node:crypto'
import { getCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import { envConfig } from '@/config/env'
import { getSession } from '@/core/sessions'
import { notAuthenticated } from '@/server/helpers/auth-problems'
import { problem } from '@/server/helpers/problem'
import { rateLimiter } from '@/server/middleware/rate-limit'
import { SESSION_COOKIE_NAME } from '@/server/middleware/session-cookie'
import type { AuthMethod, HonoEnv } from '@/server/types'

type Credential = {
  token: string
  source: 'bearer' | 'query' | 'cookie'
}

const SESSION_AUTH_METHODS = {
  bearer: 'session-bearer',
  query: 'session-query',
  cookie: 'session-cookie',
} as const satisfies Record<Credential['source'], AuthMethod>

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
  '/api/v1/setup/status',
  '/api/v1/setup/complete',
  '/api/v1/auth/status',
  '/api/v1/auth/login',
  '/api/v1/auth/register',
  '/api/v1/auth/oidc/login',
  '/api/v1/auth/oidc/callback',
  '/api/v1/docs',
  '/api/v1/docs/openapi.json',
])

const OPTIONAL_AUTH_PATHS = new Set([
  '/api/v1/setup/status',
  '/api/v1/setup/complete',
  '/api/v1/auth/status',
])

// Only SSE/audio flows are allowed to use query-param auth tokens.
const QUERY_TOKEN_PATHS = new Set(['/api/v1/pipeline/events', '/api/v1/preview/audio'])

export function authGuard(options: {
  hasUsers: () => Promise<boolean>
  isSetupComplete: () => Promise<boolean>
  resolveApiToken?: (
    token: string,
  ) => Promise<{ userId: number; scope: import('@/db/schema').ApiTokenScope } | null>
}) {
  const failedTokenLimit = rateLimiter({
    windowMs: 60_000,
    max: 20,
    keyPrefix: 'api-token-failures',
    countResponse: (c) => c.res.status === 401 && c.get('authMethod') !== 'api-token',
  })
  return createMiddleware<HonoEnv>(async (c, next) => {
    const publicPath =
      !c.req.path.startsWith('/api/v1/') ||
      PUBLIC_PATHS.has(c.req.path) ||
      /^\/api\/v1\/auth\/oauth\/[^/]+\/callback$/.test(c.req.path)

    // Skip auth for non-API paths (static assets, SPA routes), public API paths, and OAuth callbacks
    // Only the callback path is public (browser redirect from provider, no auth header).
    // Other OAuth paths (initiate, status, delete) need auth so userId is set on context.
    if (publicPath && !OPTIONAL_AUTH_PATHS.has(c.req.path)) return next()

    // Proxy auth already validated upstream - skip token checks
    const proxyAuthed = c.get('proxyAuth')
    if (proxyAuthed) return next()

    // Extract one credential and retain its source through verification.
    // Any Authorization header suppresses query/cookie fallback, including a
    // malformed or unverified header.
    const header = c.req.header('Authorization')
    let credential: Credential | undefined
    if (header !== undefined) {
      if (header.startsWith('Bearer ')) {
        credential = { token: header.slice(7), source: 'bearer' }
      }
    } else {
      const qp = c.req.query('token')
      if (qp && QUERY_TOKEN_PATHS.has(c.req.path)) {
        credential = { token: qp, source: 'query' }
      } else {
        const cookieToken = getCookie(c, SESSION_COOKIE_NAME)
        if (cookieToken) credential = { token: cookieToken, source: 'cookie' }
      }
    }

    // Try session token first
    if (
      credential?.token &&
      !(credential.source === 'bearer' && credential.token.startsWith('dga_'))
    ) {
      const session = await getSession(credential.token)
      if (session) {
        c.set('userId', session.userId)
        c.set('authMethod', SESSION_AUTH_METHODS[credential.source])
        return next()
      }
    }

    // Fall back to legacy DIGARR_AUTH_TOKEN (read-only, first user, no admin)
    const legacyToken = envConfig.authToken
    if (
      legacyToken &&
      credential &&
      credential.source !== 'cookie' &&
      safeCompare(credential.token, legacyToken)
    ) {
      console.warn(
        `[auth] DEPRECATED: Legacy token auth from ${c.req.header('x-forwarded-for') ?? 'direct'} - no admin access, no per-user features. Migrate to personal API tokens in Settings > Account.`,
      )
      // Assign userId=1 (first user) so downstream queries scope correctly
      // instead of matching NULL userId records
      c.set('userId', 1)
      c.set('legacyTokenAuth', true)
      c.set('authMethod', credential.source === 'bearer' ? 'legacy-bearer' : 'legacy-query')
      return next()
    }

    if (credential?.source === 'bearer' && credential.token.startsWith('dga_')) {
      return failedTokenLimit(c, async () => {
        const token = await options.resolveApiToken?.(credential.token)
        if (!token) {
          c.res = notAuthenticated(c)
          return
        }
        c.set('userId', token.userId)
        c.set('authMethod', 'api-token')
        c.set('apiTokenScope', token.scope)
        if (token.scope === 'read' && !['GET', 'HEAD'].includes(c.req.method)) {
          c.res = problem(
            c,
            'token-read-only',
            'Read-only token',
            403,
            undefined,
            undefined,
            'tokens.readOnlyError',
          )
          return
        }
        await next()
      })
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
      return problem(
        c,
        'setup-admin-missing',
        'Setup admin user missing',
        503,
        'Setup is complete but no admin user exists; re-run setup.',
      )
    }

    // RFC 7235: unauthenticated responses should advertise an auth scheme.
    // `realm` is an opaque client-facing tag; kept stable so automated probes
    // can key on it without parsing our domain name out.
    return notAuthenticated(c)
  })
}
