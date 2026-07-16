import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { envConfig } from '@/config/env'
import { hashPassword } from '@/core/auth'
import type { OidcService } from '@/core/auth/oidc'
import { isSingleAdminCollision } from '@/core/db-errors'
import { issueSession } from '@/server/helpers/session-auth'
import { SESSION_COOKIE_NAME } from '@/server/middleware/session-cookie'
import type { HonoEnv } from '@/server/types'

type OidcRouteDeps = {
  getOidcService: () => Promise<OidcService | null>
  getUserByOidcSubject: (subject: string) => Promise<{ id: number; username: string } | null>
  getUserByUsername: (username: string) => Promise<{ id: number; username: string } | null>
  createUser: (data: {
    username: string
    passwordHash: string
    isAdmin?: boolean
    email?: string
    oidcSubject?: string
    authProvider?: string
  }) => Promise<{ id: number; username: string }>
  getUserCount: () => Promise<number>
  updateUser: (id: number, data: { oidcSubject?: string; email?: string }) => Promise<void>
}

function buildRedirectUri(): string | null {
  // Require ALLOWED_ORIGIN for OIDC to prevent Host header spoofing (CWE-601)
  if (!envConfig.allowedOrigin) return null
  return `${envConfig.allowedOrigin}/api/v1/auth/oidc/callback`
}

const USERNAME_MAX_LENGTH = 50
const USERNAME_DISALLOWED = /[^A-Za-z0-9._-]/g

/**
 * Strip disallowed characters from an OIDC `preferred_username` claim and cap
 * length. Untrusted IdPs may supply arbitrary strings; we constrain the
 * character set to what downstream systems (filesystem paths, SQL, UI
 * rendering) can reliably handle.
 */
export function sanitizePreferredUsername(input: string): string {
  return input.replace(USERNAME_DISALLOWED, '').slice(0, USERNAME_MAX_LENGTH)
}

export function oidcRoutes(deps: OidcRouteDeps) {
  const router = new Hono<HonoEnv>()

  router.get('/api/v1/auth/oidc/login', async (c) => {
    const oidcService = await deps.getOidcService()
    if (!oidcService) return c.json({ error: 'OIDC not configured' }, 400)
    const redirectUri = buildRedirectUri()
    if (!redirectUri)
      return c.json({ error: 'ALLOWED_ORIGIN must be set when OIDC is enabled' }, 500)
    const { url } = await oidcService.getAuthorizationUrl(redirectUri)
    return c.redirect(url)
  })

  router.get('/api/v1/auth/oidc/callback', async (c) => {
    try {
      const oidcService = await deps.getOidcService()
      if (!oidcService) return c.json({ error: 'OIDC not configured' }, 400)

      if (!envConfig.allowedOrigin) {
        console.warn('[oidc] callback aborted: ALLOWED_ORIGIN not set')
        return c.redirect('/#oidc_error=config')
      }
      const baseUrl = envConfig.allowedOrigin

      const reqUrl = new URL(c.req.url)
      const callbackUrl = new URL(`${baseUrl}${reqUrl.pathname}${reqUrl.search}`)
      const result = await oidcService.handleCallback(callbackUrl)

      // User matching is by OIDC subject only, then auto-create. Linking by the
      // `email` claim is deliberately NOT done: a local account's email can be
      // self-asserted (unverified), so matching on it would let an attacker
      // pre-seed an account with a victim's email and have the victim's first
      // OIDC login bind to it (pre-link account takeover).
      let user = await deps.getUserByOidcSubject(result.claims.sub)

      if (!user) {
        const isFirstUser = (await deps.getUserCount()) === 0
        // Local registration lowercases emails and the unique index is
        // case-sensitive; store the claim lowercased so lookups keep matching.
        const email = result.claims.email?.toLowerCase()
        const rawPreferred =
          result.claims.preferredUsername ??
          result.claims.email?.split('@')[0] ??
          `oidc-${result.claims.sub.slice(0, 8)}`
        let username = sanitizePreferredUsername(rawPreferred)
        // If sanitization emptied the string, fall back to a safe derived value
        if (!username) {
          username = `oidc-${result.claims.sub.slice(0, 8)}`
        }

        // Avoid UNIQUE constraint violation on username
        const existing = await deps.getUserByUsername(username)
        if (existing) {
          username = `${username}-${result.claims.sub.slice(0, 8)}`
        }

        try {
          user = await deps.createUser({
            username,
            passwordHash: hashPassword(crypto.randomUUID()),
            isAdmin: isFirstUser,
            email,
            oidcSubject: result.claims.sub,
            authProvider: 'oidc',
          })
        } catch (err: unknown) {
          // First-admin race: a concurrent request won the admin slot via
          // the users_single_admin partial unique index. Retry as non-admin.
          if (!isFirstUser || !isSingleAdminCollision(err)) throw err
          user = await deps.createUser({
            username,
            passwordHash: hashPassword(crypto.randomUUID()),
            isAdmin: false,
            email,
            oidcSubject: result.claims.sub,
            authProvider: 'oidc',
          })
        }
      }

      const oldCookie = getCookie(c, SESSION_COOKIE_NAME)
      await issueSession(c, user.id, {
        kind: 'create',
        cookie: true,
        revokeTokens: oldCookie ? [oldCookie] : [],
      })
      return c.redirect('/')
    } catch {
      console.warn('[oidc] callback failed')
      return c.redirect('/#oidc_error=oidc_failed')
    }
  })

  return router
}
