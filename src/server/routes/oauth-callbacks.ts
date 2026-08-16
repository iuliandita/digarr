import { envConfig } from '@/config/env'
import type { PendingOAuth } from '@/db/queries/oauth-pending'
import { upsertOAuthToken } from '@/db/queries/oauth-tokens'
import type { AppDependencies } from '@/server'
import { exchangeAuthCode } from '@/server/helpers/oauth-token-exchange'
import {
  DEEZER_SCOPES,
  DEEZER_TOKEN_URL,
  SPOTIFY_TOKEN_URL,
  TIDAL_SCOPES,
  TIDAL_TOKEN_URL,
} from './oauth-providers'

export type OAuthCallbackInput = {
  deps: AppDependencies
  code: string
  pending: PendingOAuth
}

/** `ok` redirects to `oauth_success`; otherwise `error` is the `oauth_error` code. */
export type OAuthCallbackOutcome = { ok: true } | { ok: false; error: string }

export type OAuthCallbackHandler = (input: OAuthCallbackInput) => Promise<OAuthCallbackOutcome>

/** Deezer's long-lived tokens report `expires=0`; treat that as a year. */
const DEEZER_DEFAULT_EXPIRY_SECONDS = 365 * 24 * 3600

function str(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key]
  return typeof value === 'string' && value ? value : undefined
}

function num(data: Record<string, unknown>, key: string): number | undefined {
  const value = data[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Number(value)
  }
  return undefined
}

const handleSpotify: OAuthCallbackHandler = async ({ deps, code, pending }) => {
  const { clientId, clientSecret } = pending
  const redirectUri = pending.payload.redirectUri
  if (!clientId || !clientSecret || !redirectUri) {
    return { ok: false, error: 'missing_credentials' }
  }

  const result = await exchangeAuthCode({
    provider: 'Spotify',
    tokenUrl: SPOTIFY_TOKEN_URL,
    basicAuth: { clientId, clientSecret },
    params: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  })
  if (!result.ok) return result

  const accessToken = str(result.data, 'access_token')
  if (!accessToken) {
    console.error('Spotify token exchange: no access_token in response')
    return { ok: false, error: 'token_exchange_no_token' }
  }

  await upsertOAuthToken(deps.db, {
    userId: pending.userId,
    provider: 'spotify',
    accessToken,
    refreshToken: str(result.data, 'refresh_token') ?? null,
    expiresAt: new Date(Date.now() + (num(result.data, 'expires_in') ?? 3600) * 1000),
    scopes: str(result.data, 'scope') ?? null,
    clientId,
    clientSecret,
  })

  // Best-effort: OAuth already succeeded, so a target failure is not fatal.
  try {
    const existingTargets = await deps.targetQueries.getTargetsByUser(pending.userId)
    if (!existingTargets.some((t) => t.type === 'spotify-playlist')) {
      await deps.targetQueries.createTarget({
        type: 'spotify-playlist',
        name: 'Spotify Playlist',
        config: {},
        userId: pending.userId,
      })
    }
  } catch (err: unknown) {
    console.error('Failed to auto-create Spotify target:', err)
  }

  return { ok: true }
}

const handleDeezer: OAuthCallbackHandler = async ({ deps, code, pending }) => {
  if (!envConfig.deezerAppId || !envConfig.deezerAppSecret) {
    return { ok: false, error: 'missing_credentials' }
  }

  // Deezer's token endpoint only accepts GET with query params (including the
  // secret), and answers form-encoded as often as JSON. Documented, not a bug.
  const result = await exchangeAuthCode({
    provider: 'Deezer',
    tokenUrl: DEEZER_TOKEN_URL,
    method: 'GET',
    allowFormResponse: true,
    params: new URLSearchParams({
      app_id: envConfig.deezerAppId,
      secret: envConfig.deezerAppSecret,
      code,
      output: 'json',
    }),
  })
  if (!result.ok) return result

  const accessToken = str(result.data, 'access_token')
  if (!accessToken) {
    console.error('Deezer token exchange: no access_token in response')
    return { ok: false, error: 'token_exchange_no_token' }
  }

  const expires = num(result.data, 'expires')
  const expiresIn = !expires ? DEEZER_DEFAULT_EXPIRY_SECONDS : expires

  await upsertOAuthToken(deps.db, {
    userId: pending.userId,
    provider: 'deezer',
    accessToken,
    refreshToken: null,
    expiresAt: new Date(Date.now() + expiresIn * 1000),
    scopes: DEEZER_SCOPES,
    clientId: null,
    clientSecret: null,
  })

  return { ok: true }
}

const handleTidal: OAuthCallbackHandler = async ({ deps, code, pending }) => {
  const { clientId, clientSecret } = pending
  const { redirectUri, codeVerifier } = pending.payload
  if (!clientId || !clientSecret || !redirectUri || !codeVerifier) {
    return { ok: false, error: 'missing_credentials' }
  }

  const result = await exchangeAuthCode({
    provider: 'TIDAL',
    tokenUrl: TIDAL_TOKEN_URL,
    basicAuth: { clientId, clientSecret },
    params: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  })
  if (!result.ok) return result

  const accessToken = str(result.data, 'access_token')
  if (!accessToken) {
    console.error('TIDAL token exchange: no access_token in response')
    return { ok: false, error: 'token_exchange_no_token' }
  }

  await upsertOAuthToken(deps.db, {
    userId: pending.userId,
    provider: 'tidal',
    accessToken,
    refreshToken: str(result.data, 'refresh_token') ?? null,
    expiresAt: new Date(Date.now() + (num(result.data, 'expires_in') ?? 3600) * 1000),
    scopes: str(result.data, 'scope') ?? TIDAL_SCOPES,
    clientId,
    clientSecret,
  })

  return { ok: true }
}

export const OAUTH_CALLBACK_HANDLERS: Record<string, OAuthCallbackHandler> = {
  spotify: handleSpotify,
  deezer: handleDeezer,
  tidal: handleTidal,
}
