import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { envConfig } from '@/config/env'
import { hashPassword, verifyPassword } from '@/core/auth'
import { OidcCallbackError, OidcPendingCapacityError, type OidcService } from '@/core/auth/oidc'
import { hashSessionToken } from '@/db/queries/sessions'
import type { UserBootstrapOptions } from '@/db/queries/users'
import {
  fingerprintPasswordHash,
  OidcIdentityInUseError,
  type OidcLinkCredentials,
  type OidcLinkParams,
} from '@/db/queries/users'
import { sessionAuthRequired } from '@/server/helpers/auth-problems'
import {
  clearOidcTransactionCookie,
  prepareOidcTransactionCookie,
  readOidcTransactionCookie,
  setOidcTransactionCookie,
} from '@/server/helpers/oidc-transaction-cookie'
import { problem } from '@/server/helpers/problem'
import { requireSessionUser } from '@/server/helpers/require-user'
import { issueSession, prepareSessionCookie } from '@/server/helpers/session-auth'
import { SESSION_COOKIE_NAME } from '@/server/middleware/session-cookie'
import { oidcLinkSchema } from '@/server/schemas/auth'
import { zJson } from '@/server/schemas/validator'
import type { HonoEnv } from '@/server/types'

type OidcRouteDeps = {
  getOidcService: () => Promise<OidcService | null>
  getUserByOidcSubject: (subject: string) => Promise<{ id: number; username: string } | null>
  getUserByUsername: (username: string) => Promise<{ id: number; username: string } | null>
  getUserCredentialsById: (id: number) => Promise<OidcLinkCredentials | null>
  createUser: (
    data: {
      username: string
      passwordHash: string
      isAdmin?: boolean
      email?: string
      oidcSubject?: string
      authProvider?: string
    },
    options?: UserBootstrapOptions,
  ) => Promise<{ id: number; username: string }>
  linkOidcIdentity: (params: OidcLinkParams) => Promise<void>
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

    // Prepare the transaction cookie (validates cookie config) BEFORE allocating
    // any pending state, so an invalid config leaves no orphaned transaction.
    let prepared: ReturnType<typeof prepareOidcTransactionCookie>
    try {
      prepared = prepareOidcTransactionCookie(c)
    } catch {
      return c.json({ error: 'Invalid cookie configuration' }, 500)
    }

    try {
      const { url, state, browserBinding } = await oidcService.getAuthorizationUrl(redirectUri, {
        kind: 'login',
      })
      setOidcTransactionCookie(c, prepared, state, browserBinding)
      return c.redirect(url)
    } catch (err: unknown) {
      if (err instanceof OidcPendingCapacityError) {
        c.header('Retry-After', '60')
        return problem(c, 'oidc-capacity', 'OIDC login capacity reached', 503)
      }
      throw err
    }
  })

  router.post('/api/v1/auth/oidc/link', zJson(oidcLinkSchema), async (c) => {
    if (c.get('authMethod') !== 'session-cookie') return sessionAuthRequired(c)
    const auth = requireSessionUser(c)
    if (!auth.ok) return auth.response

    const sessionToken = getCookie(c, SESSION_COOKIE_NAME)
    if (!sessionToken) return sessionAuthRequired(c)

    const user = await deps.getUserCredentialsById(auth.userId)
    if (!user) return c.json({ error: 'User not found' }, 404)
    if (user.authProvider !== 'local' || user.oidcSubject !== null) {
      return problem(c, 'oidc-link-unavailable', 'OIDC account linking is unavailable', 409)
    }

    const { currentPassword } = c.req.valid('json')
    if (!verifyPassword(currentPassword, user.passwordHash)) {
      return problem(
        c,
        'auth-password-incorrect',
        'Current password is incorrect',
        403,
        undefined,
        undefined,
        'errors.auth.passwordIncorrect',
      )
    }
    const oidcService = await deps.getOidcService()
    if (!oidcService) return c.json({ error: 'OIDC not configured' }, 400)
    const redirectUri = buildRedirectUri()
    if (!redirectUri) {
      return c.json({ error: 'ALLOWED_ORIGIN must be set when OIDC is enabled' }, 500)
    }

    let prepared: ReturnType<typeof prepareOidcTransactionCookie>
    try {
      prepared = prepareOidcTransactionCookie(c)
    } catch {
      return c.json({ error: 'Invalid cookie configuration' }, 500)
    }

    try {
      const { url, state, browserBinding } = await oidcService.getAuthorizationUrl(redirectUri, {
        kind: 'link',
        userId: auth.userId,
        sessionHash: hashSessionToken(sessionToken),
        passwordFingerprint: fingerprintPasswordHash(user.passwordHash),
      })
      setOidcTransactionCookie(c, prepared, state, browserBinding)
      c.header('Cache-Control', 'no-store')
      return c.json({ url })
    } catch (error) {
      if (error instanceof OidcPendingCapacityError) {
        c.header('Retry-After', '60')
        return problem(c, 'oidc-capacity', 'OIDC login capacity reached', 503)
      }
      throw error
    }
  })

  router.get('/api/v1/auth/oidc/callback', async (c) => {
    const reqUrl = new URL(c.req.url)
    const state = reqUrl.searchParams.get('state') ?? ''
    // Read the state-specific binding cookie, then delete it immediately so
    // every later response (success or failure) clears the identified
    // transaction and the code can be exchanged at most once.
    const browserBinding = readOidcTransactionCookie(c, state)
    clearOidcTransactionCookie(c, state)

    let linkCallback = false
    try {
      const oidcService = await deps.getOidcService()
      if (!oidcService) return c.json({ error: 'OIDC not configured' }, 400)

      if (!envConfig.allowedOrigin) {
        console.warn('[oidc] callback aborted: ALLOWED_ORIGIN not set')
        return c.redirect('/#oidc_error=config')
      }
      const baseUrl = envConfig.allowedOrigin

      const callbackUrl = new URL(`${baseUrl}${reqUrl.pathname}${reqUrl.search}`)
      const result = await oidcService.handleCallback(callbackUrl, browserBinding)

      if (result.purpose.kind === 'link') {
        linkCallback = true
        c.header('Cache-Control', 'no-store')
        const presentedSession = getCookie(c, SESSION_COOKIE_NAME)
        if (!presentedSession) throw new Error('OIDC link session is missing')

        await deps.linkOidcIdentity({
          userId: result.purpose.userId,
          oidcSubject: result.claims.sub,
          passwordFingerprint: result.purpose.passwordFingerprint,
          initiatingSessionHash: result.purpose.sessionHash,
          presentedSessionHash: hashSessionToken(presentedSession),
        })
        return c.redirect('/settings?tab=account&oidc_link=success')
      }

      const sessionCookie = prepareSessionCookie(c)

      // User matching is by OIDC subject only, then auto-create. Linking by the
      // `email` claim is deliberately NOT done: a local account's email can be
      // self-asserted (unverified), so matching on it would let an attacker
      // pre-seed an account with a victim's email and have the victim's first
      // OIDC login bind to it (pre-link account takeover).
      let user = await deps.getUserByOidcSubject(result.claims.sub)

      if (!user) {
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

        user = await deps.createUser(
          {
            username,
            passwordHash: hashPassword(crypto.randomUUID()),
            email,
            oidcSubject: result.claims.sub,
            authProvider: 'oidc',
          },
          { bootstrap: 'allow-existing' },
        )
      }

      const oldCookie = getCookie(c, SESSION_COOKIE_NAME)
      await issueSession(c, user.id, {
        kind: 'create',
        cookie: sessionCookie,
        revokeTokens: oldCookie ? [oldCookie] : [],
      })
      return c.redirect('/')
    } catch (error) {
      console.warn('[oidc] callback failed')
      if (linkCallback || (error instanceof OidcCallbackError && error.purpose.kind === 'link')) {
        const result = error instanceof OidcIdentityInUseError ? 'identity_in_use' : 'failed'
        return c.redirect(`/settings?tab=account&oidc_link=${result}`)
      }
      return c.redirect('/#oidc_error=oidc_failed')
    }
  })

  return router
}
