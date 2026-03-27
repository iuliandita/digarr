import { Hono } from 'hono'
import {
  deleteOAuthToken,
  findPendingOAuthByState,
  getOAuthToken,
  upsertOAuthToken,
} from '@/db/queries/oauth-tokens'
import type { AppDependencies } from '@/server'
import type { HonoEnv } from '@/server/types'

const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize'
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token'
const SPOTIFY_SCOPES =
  'user-top-read user-read-recently-played playlist-modify-private playlist-modify-public'

export function oauthRoutes(deps: AppDependencies) {
  const router = new Hono<HonoEnv>()

  // Initiate OAuth flow for a provider
  router.post('/api/auth/oauth/:provider/initiate', async (c) => {
    const provider = c.req.param('provider')
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Authentication required' }, 401)

    const body = await c.req.json()
    const { clientId, clientSecret, redirectUri } = body as {
      clientId: string
      clientSecret: string
      redirectUri: string
    }

    if (!clientId || !clientSecret || !redirectUri) {
      return c.json({ error: 'clientId, clientSecret, and redirectUri are required' }, 400)
    }

    switch (provider) {
      case 'spotify': {
        // Use opaque state token -- userId is stored server-side, not in the URL
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
      default:
        return c.json({ error: `Unknown OAuth provider: ${provider}` }, 400)
    }
  })

  // OAuth callback -- exchanges code for tokens
  router.get('/api/auth/oauth/:provider/callback', async (c) => {
    const provider = c.req.param('provider')
    const code = c.req.query('code')
    const state = c.req.query('state')
    const error = c.req.query('error')

    if (error) {
      return c.redirect(`/settings?oauth_error=${encodeURIComponent(error)}`)
    }

    if (!code || !state) {
      return c.redirect('/settings?oauth_error=missing_code_or_state')
    }

    // Resolve userId from server-side pending token, not from the URL state param.
    // The pending token stores `pending:{userId}:{opaqueState}` and state is just the opaque part.
    const pendingToken = await findPendingOAuthByState(deps.db, 'spotify', state)
    if (!pendingToken || !pendingToken.accessToken.startsWith('pending:')) {
      return c.redirect('/settings?oauth_error=no_pending_auth')
    }
    const userId = pendingToken.userId

    switch (provider) {
      case 'spotify': {
        const pending = pendingToken

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
          `${c.req.header('x-forwarded-proto') ?? 'http'}://${c.req.header('host')}/api/auth/oauth/spotify/callback`

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
          // Non-fatal -- OAuth succeeded, target creation is best-effort
        }

        return c.redirect('/settings?oauth_success=spotify')
      }
      default:
        return c.redirect('/settings?oauth_error=unknown_provider')
    }
  })

  // Disconnect an OAuth provider
  router.delete('/api/auth/oauth/:provider', async (c) => {
    const provider = c.req.param('provider')
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Authentication required' }, 401)

    await deleteOAuthToken(deps.db, userId, provider)
    return c.json({ success: true })
  })

  // Check OAuth connection status
  router.get('/api/auth/oauth/:provider/status', async (c) => {
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
