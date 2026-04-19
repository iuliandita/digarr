import { Hono } from 'hono'
import { envConfig } from '@/config/env'
import { generateSessionToken, hashPassword } from '@/core/auth'
import type { OidcService } from '@/core/auth/oidc'
import { isSingleAdminCollision } from '@/core/db-errors'
import { createSession } from '@/core/sessions'

type OidcRouteDeps = {
  getOidcService: () => Promise<OidcService | null>
  getUserByOidcSubject: (subject: string) => Promise<{ id: number; username: string } | null>
  getUserByEmail: (email: string) => Promise<{ id: number; username: string } | null>
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

/**
 * Decide whether an OIDC callback is allowed to auto-link to an existing
 * local user by matching on the `email` claim.
 *
 * Gated behind OIDC_TRUST_EMAIL_VERIFIED because a multi-tenant or public
 * issuer can claim `email_verified=true` for arbitrary email strings,
 * which would let it hijack any account with that email. Single-tenant
 * IdPs with controlled domains are safe to opt in.
 *
 * Returns the email to link on success, or null to refuse.
 */
export function maybeAutoLink(
  claims: { email?: string; emailVerified?: boolean },
  trustEmailVerified: boolean,
): string | null {
  if (!trustEmailVerified) return null
  if (claims.emailVerified !== true) return null
  if (!claims.email) return null
  return claims.email
}

export function oidcRoutes(deps: OidcRouteDeps) {
  const router = new Hono()

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

      // User matching: OIDC subject -> email -> username -> auto-create
      let user = await deps.getUserByOidcSubject(result.claims.sub)

      if (!user) {
        const emailToLink = maybeAutoLink(
          { email: result.claims.email, emailVerified: result.claims.emailVerified },
          envConfig.oidcTrustEmailVerified,
        )
        if (emailToLink) {
          const emailUser = await deps.getUserByEmail(emailToLink)
          if (emailUser) {
            await deps.updateUser(emailUser.id, { oidcSubject: result.claims.sub })
            user = emailUser
          }
        }
      }

      if (!user) {
        const isFirstUser = (await deps.getUserCount()) === 0
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
            email: result.claims.email,
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
            email: result.claims.email,
            oidcSubject: result.claims.sub,
            authProvider: 'oidc',
          })
        }
      }

      const sessionToken = generateSessionToken()
      await createSession(user.id, sessionToken)
      // Use fragment (#) not query param (?) - fragments are never sent to
      // the server in Referer headers or logged by reverse proxies
      return c.redirect(`/#oidc_token=${encodeURIComponent(sessionToken)}`)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'OIDC authentication failed'
      console.warn('[oidc] callback failed:', message)
      return c.redirect('/#oidc_error=oidc_failed')
    }
  })

  return router
}
