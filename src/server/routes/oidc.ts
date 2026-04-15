import { Hono } from 'hono'
import { envConfig } from '@/config/env'
import { generateSessionToken, hashPassword } from '@/core/auth'
import type { OidcService } from '@/core/auth/oidc'
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
  return `${envConfig.allowedOrigin}/api/auth/oidc/callback`
}

export function oidcRoutes(deps: OidcRouteDeps) {
  const router = new Hono()

  router.get('/api/auth/oidc/login', async (c) => {
    const oidcService = await deps.getOidcService()
    if (!oidcService) return c.json({ error: 'OIDC not configured' }, 400)
    const redirectUri = buildRedirectUri()
    if (!redirectUri)
      return c.json({ error: 'ALLOWED_ORIGIN must be set when OIDC is enabled' }, 500)
    const { url } = await oidcService.getAuthorizationUrl(redirectUri)
    return c.redirect(url)
  })

  router.get('/api/auth/oidc/callback', async (c) => {
    try {
      const oidcService = await deps.getOidcService()
      if (!oidcService) return c.json({ error: 'OIDC not configured' }, 400)

      if (!envConfig.allowedOrigin) {
        return c.redirect('/#oidc_error=ALLOWED_ORIGIN+must+be+set+when+OIDC+is+enabled')
      }
      const baseUrl = envConfig.allowedOrigin

      const reqUrl = new URL(c.req.url)
      const callbackUrl = new URL(`${baseUrl}${reqUrl.pathname}${reqUrl.search}`)
      const result = await oidcService.handleCallback(callbackUrl)

      // User matching: OIDC subject -> email -> username -> auto-create
      let user = await deps.getUserByOidcSubject(result.claims.sub)

      if (!user && result.claims.email && result.claims.emailVerified === true) {
        const emailUser = await deps.getUserByEmail(result.claims.email)
        if (emailUser) {
          await deps.updateUser(emailUser.id, { oidcSubject: result.claims.sub })
          user = emailUser
        }
      }

      if (!user) {
        const isFirstUser = (await deps.getUserCount()) === 0
        let username =
          result.claims.preferredUsername ??
          result.claims.email?.split('@')[0] ??
          `oidc-${result.claims.sub.slice(0, 8)}`

        // Avoid UNIQUE constraint violation on username
        const existing = await deps.getUserByUsername(username)
        if (existing) {
          username = `${username}-${result.claims.sub.slice(0, 8)}`
        }

        user = await deps.createUser({
          username,
          passwordHash: hashPassword(crypto.randomUUID()),
          isAdmin: isFirstUser,
          email: result.claims.email,
          oidcSubject: result.claims.sub,
          authProvider: 'oidc',
        })
      }

      const sessionToken = generateSessionToken()
      await createSession(user.id, sessionToken)
      // Use fragment (#) not query param (?) - fragments are never sent to
      // the server in Referer headers or logged by reverse proxies
      return c.redirect(`/#oidc_token=${encodeURIComponent(sessionToken)}`)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'OIDC authentication failed'
      return c.redirect(`/#oidc_error=${encodeURIComponent(message)}`)
    }
  })

  return router
}
