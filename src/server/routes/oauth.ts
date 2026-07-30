import { createHash, randomBytes } from 'node:crypto'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { envConfig } from '@/config/env'
import type { Database } from '@/db'
import {
  consumePendingOAuth,
  createPendingOAuth,
  type PendingOAuth,
  pendingBindingMatches,
} from '@/db/queries/oauth-pending'
import { deleteOAuthToken, getOAuthToken } from '@/db/queries/oauth-tokens'
import type { AppDependencies } from '@/server'
import {
  clearOAuthTransactionCookie,
  createOAuthBinding,
  readOAuthTransactionCookie,
  setOAuthTransactionCookie,
} from '@/server/helpers/oauth-transaction-cookie'
import { oauthInitiateSchema } from '@/server/schemas/oauth'
import { zJson } from '@/server/schemas/validator'
import type { HonoEnv } from '@/server/types'
import { OAUTH_CALLBACK_HANDLERS } from './oauth-callbacks'
import {
  DEEZER_AUTH_URL,
  DEEZER_SCOPES,
  SPOTIFY_AUTH_URL,
  SPOTIFY_SCOPES,
  TIDAL_AUTH_URL,
  TIDAL_SCOPES,
} from './oauth-providers'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

function isLoopbackRedirect(uri: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(uri).hostname)
  } catch {
    return false
  }
}

function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

type PendingResolution =
  | { ok: true; pending: PendingOAuth }
  | { ok: false; error: 'no_pending_auth' | 'state_expired' | 'browser_mismatch' }

/**
 * Redeem the pending row for this state and check the three things that make it
 * usable: it exists (single-use - consuming deletes it), it is inside its TTL,
 * and it was started by this browser.
 */
async function resolvePending(
  c: Context<HonoEnv>,
  db: Database,
  provider: string,
  state: string,
): Promise<PendingResolution> {
  const binding = readOAuthTransactionCookie(c, provider, state)
  clearOAuthTransactionCookie(c, provider, state)

  const pending = await consumePendingOAuth(db, provider, state)
  if (!pending) return { ok: false, error: 'no_pending_auth' }
  if (pending.expiresAt.getTime() <= Date.now()) return { ok: false, error: 'state_expired' }
  if (!pendingBindingMatches(pending.bindingHash, binding)) {
    return { ok: false, error: 'browser_mismatch' }
  }
  return { ok: true, pending }
}

export function oauthRoutes(deps: AppDependencies) {
  const router = new Hono<HonoEnv>()

  // Initiate OAuth flow for a provider
  router.post('/api/v1/auth/oauth/:provider/initiate', zJson(oauthInitiateSchema), async (c) => {
    const provider = c.req.param('provider')
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Authentication required' }, 401)

    const { clientId, clientSecret, redirectUri } = c.req.valid('json')

    // Opaque state; only its digest is stored, and the browser binding ties the
    // callback back to the browser that started the flow.
    const state = crypto.randomUUID()
    const binding = createOAuthBinding()

    switch (provider) {
      case 'spotify': {
        if (!clientId || !clientSecret || !redirectUri) {
          return c.json({ error: 'clientId, clientSecret, and redirectUri are required' }, 400)
        }
        if (!setOAuthTransactionCookie(c, 'spotify', state, binding)) {
          return c.json({ error: 'Invalid cookie configuration' }, 500)
        }

        await createPendingOAuth(deps.db, {
          userId,
          provider: 'spotify',
          state,
          binding,
          payload: { redirectUri },
          scopes: SPOTIFY_SCOPES,
          clientId,
          clientSecret,
        })

        const params = new URLSearchParams({
          response_type: 'code',
          client_id: clientId,
          scope: SPOTIFY_SCOPES,
          redirect_uri: redirectUri,
          state,
        })

        return c.json({ authUrl: `${SPOTIFY_AUTH_URL}?${params}` })
      }
      case 'deezer': {
        if (!envConfig.deezerAppId || !envConfig.deezerAppSecret) {
          return c.json({ error: 'Deezer app credentials are not configured on the server' }, 400)
        }

        // Prefer the configured public origin; the header-derived URI is a
        // legacy fallback for installs that never set ALLOWED_ORIGIN.
        const proto = c.req.header('x-forwarded-proto') ?? 'http'
        const host = c.req.header('host') ?? 'localhost'
        const deezerRedirectUri = envConfig.allowedOrigin
          ? `${envConfig.allowedOrigin}/api/v1/auth/oauth/deezer/callback`
          : `${proto}://${host}/api/v1/auth/oauth/deezer/callback`

        if (!setOAuthTransactionCookie(c, 'deezer', state, binding)) {
          return c.json({ error: 'Invalid cookie configuration' }, 500)
        }

        await createPendingOAuth(deps.db, {
          userId,
          provider: 'deezer',
          state,
          binding,
          payload: { redirectUri: deezerRedirectUri },
          scopes: DEEZER_SCOPES,
        })

        const params = new URLSearchParams({
          app_id: envConfig.deezerAppId,
          redirect_uri: deezerRedirectUri,
          perms: DEEZER_SCOPES,
          state,
        })

        return c.json({ authUrl: `${DEEZER_AUTH_URL}?${params}` })
      }
      case 'tidal': {
        const settings = await deps.getSettings()
        const tidalClientId = settings?.tidalClientId
        const tidalClientSecret = settings?.tidalClientSecret
        if (!tidalClientId || !tidalClientSecret) {
          return c.json({ error: 'TIDAL app credentials are not configured on the server' }, 400)
        }
        // One shared app means one server-controlled callback: derive it from the
        // configured public origin. ALLOWED_ORIGIN has no default, so the
        // client-supplied fallback is a real deployment path, not just local dev
        // - constrain it to loopback and refuse it outside development.
        let tidalRedirectUri = envConfig.allowedOrigin
          ? `${envConfig.allowedOrigin}/api/v1/auth/oauth/tidal/callback`
          : undefined
        if (!tidalRedirectUri) {
          if (process.env.NODE_ENV === 'production') {
            return c.json({ error: 'ALLOWED_ORIGIN must be set to connect TIDAL' }, 400)
          }
          if (!redirectUri) return c.json({ error: 'redirectUri is required' }, 400)
          if (!isLoopbackRedirect(redirectUri)) {
            return c.json(
              { error: 'redirectUri must be a loopback URL unless ALLOWED_ORIGIN is set' },
              400,
            )
          }
          tidalRedirectUri = redirectUri
        }

        const { verifier, challenge } = createPkcePair()

        if (!setOAuthTransactionCookie(c, 'tidal', state, binding)) {
          return c.json({ error: 'Invalid cookie configuration' }, 500)
        }

        await createPendingOAuth(deps.db, {
          userId,
          provider: 'tidal',
          state,
          binding,
          payload: { redirectUri: tidalRedirectUri, codeVerifier: verifier },
          scopes: TIDAL_SCOPES,
          clientId: tidalClientId,
          clientSecret: tidalClientSecret,
        })

        const params = new URLSearchParams({
          response_type: 'code',
          client_id: tidalClientId,
          scope: TIDAL_SCOPES,
          redirect_uri: tidalRedirectUri,
          code_challenge: challenge,
          code_challenge_method: 'S256',
          state,
        })

        return c.json({ authUrl: `${TIDAL_AUTH_URL}?${params}` })
      }
      default:
        return c.json({ error: `Unknown OAuth provider: ${provider}` }, 400)
    }
  })

  // OAuth callback - exchanges code for tokens
  router.get('/api/v1/auth/oauth/:provider/callback', async (c) => {
    const provider = c.req.param('provider')
    const code = c.req.query('code')
    const state = c.req.query('state')
    const error = c.req.query('error') ?? c.req.query('error_reason')

    if (error) {
      return c.redirect(`/settings?oauth_error=${encodeURIComponent(error)}`)
    }

    if (!code || !state) {
      return c.redirect('/settings?oauth_error=missing_code_or_state')
    }

    const handler = OAUTH_CALLBACK_HANDLERS[provider]
    if (!handler) return c.redirect('/settings?oauth_error=unknown_provider')

    // The userId comes from the server-side pending row, never from the URL.
    const resolved = await resolvePending(c, deps.db, provider, state)
    if (!resolved.ok) return c.redirect(`/settings?oauth_error=${resolved.error}`)

    const outcome = await handler({ deps, code, pending: resolved.pending })
    return c.redirect(
      outcome.ok ? `/settings?oauth_success=${provider}` : `/settings?oauth_error=${outcome.error}`,
    )
  })

  // Disconnect an OAuth provider
  router.delete('/api/v1/auth/oauth/:provider', async (c) => {
    const provider = c.req.param('provider')
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Authentication required' }, 401)

    await deleteOAuthToken(deps.db, userId, provider)
    return c.body(null, 204)
  })

  // Check OAuth connection status
  router.get('/api/v1/auth/oauth/:provider/status', async (c) => {
    const provider = c.req.param('provider')
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Authentication required' }, 401)

    const token = await getOAuthToken(deps.db, userId, provider)
    return c.json({
      connected: !!token,
      scopes: token?.scopes ?? null,
      expiresAt: token?.expiresAt ?? null,
    })
  })

  return router
}
