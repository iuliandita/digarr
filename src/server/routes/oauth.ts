import { createHash, randomBytes } from 'node:crypto'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { envConfig } from '@/config/env'
import { redactSecrets } from '@/core/validation'
import type { Database } from '@/db'
import {
  consumePendingOAuth,
  createPendingOAuth,
  type PendingOAuth,
  pendingBindingMatches,
} from '@/db/queries/oauth-pending'
import { deleteOAuthToken, getOAuthToken, upsertOAuthToken } from '@/db/queries/oauth-tokens'
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

const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize'
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token'
const SPOTIFY_SCOPES =
  'user-top-read user-read-recently-played user-library-read user-follow-read playlist-modify-private playlist-modify-public'

const DEEZER_AUTH_URL = 'https://connect.deezer.com/oauth/auth.php'
const DEEZER_TOKEN_URL = 'https://connect.deezer.com/oauth/access_token.php'
const DEEZER_SCOPES = 'basic_access,email,listening_history'

const TIDAL_AUTH_URL = 'https://login.tidal.com/authorize'
const TIDAL_TOKEN_URL = 'https://auth.tidal.com/v1/oauth2/token'
const TIDAL_SCOPES = 'user.read collection.read'

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

    switch (provider) {
      case 'spotify': {
        // The userId comes from the server-side pending row, never from the URL.
        const resolved = await resolvePending(c, deps.db, 'spotify', state)
        if (!resolved.ok) return c.redirect(`/settings?oauth_error=${resolved.error}`)
        const { pending } = resolved
        const userId = pending.userId

        const { clientId, clientSecret } = pending
        const redirectUri = pending.payload.redirectUri
        if (!clientId || !clientSecret || !redirectUri) {
          return c.redirect('/settings?oauth_error=missing_credentials')
        }

        const controller = new AbortController()
        const tokenTimer = setTimeout(() => controller.abort(), 10_000)
        let tokenRes: Response
        try {
          tokenRes = await fetch(SPOTIFY_TOKEN_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
            },
            body: new URLSearchParams({
              grant_type: 'authorization_code',
              code,
              redirect_uri: redirectUri,
            }),
            signal: controller.signal,
          })
        } finally {
          clearTimeout(tokenTimer)
        }

        if (!tokenRes.ok) {
          console.error(`Spotify token exchange failed: ${tokenRes.status}`)
          return c.redirect('/settings?oauth_error=token_exchange_failed')
        }

        const tokenData = (await tokenRes.json()) as {
          access_token: string
          refresh_token: string
          expires_in: number
          scope: string
          token_type: string
        }

        await upsertOAuthToken(deps.db, {
          userId,
          provider: 'spotify',
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          expiresAt: new Date(Date.now() + tokenData.expires_in * 1000),
          scopes: tokenData.scope,
          clientId,
          clientSecret,
        })

        // Auto-create spotify-playlist target if not already present
        try {
          const existingTargets = await deps.targetQueries.getTargetsByUser(userId)
          const hasSpotifyTarget = existingTargets.some((t) => t.type === 'spotify-playlist')
          if (!hasSpotifyTarget) {
            await deps.targetQueries.createTarget({
              type: 'spotify-playlist',
              name: 'Spotify Playlist',
              config: {},
              userId,
            })
          }
        } catch (err: unknown) {
          console.error('Failed to auto-create Spotify target:', err)
          // Non-fatal - OAuth succeeded, target creation is best-effort
        }

        return c.redirect('/settings?oauth_success=spotify')
      }
      case 'deezer': {
        const resolved = await resolvePending(c, deps.db, 'deezer', state)
        if (!resolved.ok) return c.redirect(`/settings?oauth_error=${resolved.error}`)
        const deezerUserId = resolved.pending.userId

        if (!envConfig.deezerAppId || !envConfig.deezerAppSecret) {
          return c.redirect('/settings?oauth_error=missing_credentials')
        }

        const tokenParams = new URLSearchParams({
          app_id: envConfig.deezerAppId,
          secret: envConfig.deezerAppSecret,
          code,
          output: 'json',
        })

        // Deezer's token endpoint only accepts GET with query params (including secret).
        // This is their documented OAuth flow, not a mistake.
        const deezerController = new AbortController()
        const deezerTimer = setTimeout(() => deezerController.abort(), 10_000)
        let deezerTokenRes: Response
        try {
          deezerTokenRes = await fetch(`${DEEZER_TOKEN_URL}?${tokenParams}`, {
            signal: deezerController.signal,
          })
        } finally {
          clearTimeout(deezerTimer)
        }

        if (!deezerTokenRes.ok) {
          console.error(`Deezer token exchange failed: ${deezerTokenRes.status}`)
          return c.redirect('/settings?oauth_error=token_exchange_failed')
        }

        const rawBody = await deezerTokenRes.text()
        let deezerTokenData: { access_token?: string; expires?: number } = {}
        try {
          deezerTokenData = JSON.parse(rawBody)
        } catch {
          // Fall back to form-encoded (e.g. "access_token=xxx&expires=0")
          const parsed = new URLSearchParams(rawBody)
          deezerTokenData = {
            access_token: parsed.get('access_token') ?? undefined,
            expires: parsed.has('expires') ? Number(parsed.get('expires')) : undefined,
          }
        }

        if (!deezerTokenData.access_token) {
          console.error('Deezer token exchange: no access_token in response')
          return c.redirect('/settings?oauth_error=token_exchange_failed')
        }

        // expires=0 means long-lived - treat as 1 year
        const expiresIn =
          deezerTokenData.expires === 0
            ? 365 * 24 * 3600
            : (deezerTokenData.expires ?? 365 * 24 * 3600)
        const expiresAt = new Date(Date.now() + expiresIn * 1000)

        await upsertOAuthToken(deps.db, {
          userId: deezerUserId,
          provider: 'deezer',
          accessToken: deezerTokenData.access_token,
          refreshToken: null,
          expiresAt,
          scopes: DEEZER_SCOPES,
          clientId: null,
          clientSecret: null,
        })

        return c.redirect('/settings?oauth_success=deezer')
      }
      case 'tidal': {
        const resolved = await resolvePending(c, deps.db, 'tidal', state)
        if (!resolved.ok) return c.redirect(`/settings?oauth_error=${resolved.error}`)
        const tidalPending = resolved.pending
        const tidalUserId = tidalPending.userId

        const { clientId, clientSecret } = tidalPending
        const { redirectUri, codeVerifier } = tidalPending.payload
        if (!clientId || !clientSecret || !redirectUri || !codeVerifier) {
          return c.redirect('/settings?oauth_error=missing_credentials')
        }

        const tidalController = new AbortController()
        const tidalTimer = setTimeout(() => tidalController.abort(), 10_000)
        let tidalTokenRes: Response
        try {
          tidalTokenRes = await fetch(TIDAL_TOKEN_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
            },
            body: new URLSearchParams({
              grant_type: 'authorization_code',
              code,
              client_id: clientId,
              redirect_uri: redirectUri,
              code_verifier: codeVerifier,
            }),
            signal: tidalController.signal,
          })
        } catch (err) {
          console.error('TIDAL token exchange request failed:', err)
          return c.redirect('/settings?oauth_error=token_exchange_unreachable')
        } finally {
          clearTimeout(tidalTimer)
        }

        if (!tidalTokenRes.ok) {
          // The upstream error body is the only diagnosable artifact for a flow
          // that has never been exercised against a live TIDAL account.
          const detail = redactSecrets(await tidalTokenRes.text().catch(() => '')).slice(0, 300)
          console.error(`TIDAL token exchange failed: ${tidalTokenRes.status} ${detail}`)
          return c.redirect('/settings?oauth_error=token_exchange_failed')
        }

        let tidalTokenData: {
          access_token?: string
          refresh_token?: string
          expires_in?: number
          scope?: string
        }
        try {
          tidalTokenData = await tidalTokenRes.json()
        } catch (err) {
          console.error('TIDAL token exchange returned a non-JSON body:', err)
          return c.redirect('/settings?oauth_error=token_exchange_malformed')
        }

        if (!tidalTokenData.access_token) {
          console.error('TIDAL token exchange: no access_token in response')
          return c.redirect('/settings?oauth_error=token_exchange_no_token')
        }

        await upsertOAuthToken(deps.db, {
          userId: tidalUserId,
          provider: 'tidal',
          accessToken: tidalTokenData.access_token,
          refreshToken: tidalTokenData.refresh_token ?? null,
          expiresAt: new Date(Date.now() + (tidalTokenData.expires_in ?? 3600) * 1000),
          scopes: tidalTokenData.scope ?? TIDAL_SCOPES,
          clientId,
          clientSecret,
        })

        return c.redirect('/settings?oauth_success=tidal')
      }
      default:
        return c.redirect('/settings?oauth_error=unknown_provider')
    }
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
