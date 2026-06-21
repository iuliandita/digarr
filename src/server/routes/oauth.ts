import { Hono } from 'hono'
import { envConfig } from '@/config/env'
import {
  deleteOAuthToken,
  findPendingOAuthByState,
  getOAuthToken,
  upsertOAuthToken,
} from '@/db/queries/oauth-tokens'
import type { AppDependencies } from '@/server'
import { oauthInitiateSchema } from '@/server/schemas/oauth'
import { zJson } from '@/server/schemas/validator'
import type { HonoEnv } from '@/server/types'

const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize'
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token'
const SPOTIFY_SCOPES =
  'user-top-read user-read-recently-played user-library-read playlist-modify-private playlist-modify-public'

const DEEZER_AUTH_URL = 'https://connect.deezer.com/oauth/auth.php'
const DEEZER_TOKEN_URL = 'https://connect.deezer.com/oauth/access_token.php'
const DEEZER_SCOPES = 'basic_access,email,listening_history,manage_library'

export function oauthRoutes(deps: AppDependencies) {
  const router = new Hono<HonoEnv>()

  // Initiate OAuth flow for a provider
  router.post('/api/v1/auth/oauth/:provider/initiate', zJson(oauthInitiateSchema), async (c) => {
    const provider = c.req.param('provider')
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Authentication required' }, 401)

    const { clientId, clientSecret, redirectUri } = c.req.valid('json')

    switch (provider) {
      case 'spotify': {
        if (!clientId || !clientSecret || !redirectUri) {
          return c.json({ error: 'clientId, clientSecret, and redirectUri are required' }, 400)
        }
        // Use opaque state token - userId is stored server-side, not in the URL
        const state = crypto.randomUUID()
        // Store client credentials temporarily so the callback can use them
        await upsertOAuthToken(deps.db, {
          userId,
          provider: 'spotify',
          accessToken: `pending:${userId}:${state}`,
          refreshToken: redirectUri, // stash redirect URI for callback
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
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

        const state = crypto.randomUUID()
        const proto = c.req.header('x-forwarded-proto') ?? 'http'
        const host = c.req.header('host') ?? 'localhost'
        const deezerRedirectUri = `${proto}://${host}/api/v1/auth/oauth/deezer/callback`

        await upsertOAuthToken(deps.db, {
          userId,
          provider: 'deezer',
          accessToken: `pending:${userId}:${state}`,
          refreshToken: null,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
          scopes: DEEZER_SCOPES,
          clientId: null,
          clientSecret: null,
        })

        const params = new URLSearchParams({
          app_id: envConfig.deezerAppId,
          redirect_uri: deezerRedirectUri,
          perms: DEEZER_SCOPES,
          state,
        })

        return c.json({ authUrl: `${DEEZER_AUTH_URL}?${params}` })
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
        // Resolve userId from server-side pending token, not from the URL state param.
        // The pending token stores `pending:{userId}:{opaqueState}` and state is just the opaque part.
        const pending = await findPendingOAuthByState(deps.db, 'spotify', state)
        if (!pending || !pending.accessToken.startsWith('pending:')) {
          return c.redirect('/settings?oauth_error=no_pending_auth')
        }
        const userId = pending.userId

        // CSRF: verify the state matches the stored opaque state
        if (pending.accessToken !== `pending:${userId}:${state}`) {
          return c.redirect('/settings?oauth_error=state_mismatch')
        }

        const { clientId, clientSecret } = pending
        if (!clientId || !clientSecret) {
          return c.redirect('/settings?oauth_error=missing_credentials')
        }

        // Reuse the exact redirect URI from initiate (stored in refreshToken during pending)
        const redirectUri =
          pending.refreshToken ??
          `${c.req.header('x-forwarded-proto') ?? 'http'}://${c.req.header('host')}/api/v1/auth/oauth/spotify/callback`

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
        const deezerPending = await findPendingOAuthByState(deps.db, 'deezer', state)
        if (!deezerPending || !deezerPending.accessToken.startsWith('pending:')) {
          return c.redirect('/settings?oauth_error=no_pending_auth')
        }
        const deezerUserId = deezerPending.userId

        if (deezerPending.accessToken !== `pending:${deezerUserId}:${state}`) {
          return c.redirect('/settings?oauth_error=state_mismatch')
        }

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
    const connected = !!token && !token.accessToken.startsWith('pending:')
    return c.json({
      connected,
      scopes: connected ? token?.scopes : null,
      expiresAt: connected ? token?.expiresAt : null,
    })
  })

  return router
}
