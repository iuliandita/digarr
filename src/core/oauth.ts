import { redactSecrets } from '@/core/validation'
import type { Database } from '@/db'
import { getOAuthToken, upsertOAuthToken } from '@/db/queries/oauth-tokens'

export type OAuthRefreshConfig = {
  tokenEndpoint: string
  clientId: string
  clientSecret: string
  /**
   * How the client authenticates to the token endpoint. A given OAuth client
   * accepts one style, so this must match the authorization-code exchange that
   * created the token. Defaults to `body`.
   */
  authStyle?: 'basic' | 'body'
}

type TokenResponse = {
  access_token: string
  refresh_token?: string
  expires_in: number
  token_type: string
}

const EXPIRY_BUFFER_MS = 5 * 60 * 1000 // 5 minutes

export async function getValidToken(
  db: Database,
  userId: number,
  provider: string,
  refreshConfig: OAuthRefreshConfig,
): Promise<string | null> {
  const token = await getOAuthToken(db, userId, provider)
  if (!token) return null

  const now = new Date()
  const bufferExpiry = new Date(token.expiresAt.getTime() - EXPIRY_BUFFER_MS)

  if (now < bufferExpiry) {
    return token.accessToken
  }

  // Token expired or about to expire - refresh it
  if (!token.refreshToken) return null

  const basicAuth = refreshConfig.authStyle === 'basic'
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: token.refreshToken,
    client_id: refreshConfig.clientId,
  })
  if (!basicAuth) params.set('client_secret', refreshConfig.clientSecret)

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  }
  if (basicAuth) {
    headers.Authorization = `Basic ${btoa(`${refreshConfig.clientId}:${refreshConfig.clientSecret}`)}`
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  let res: Response
  try {
    res = await fetch(refreshConfig.tokenEndpoint, {
      method: 'POST',
      headers,
      body: params.toString(),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    // The upstream body can echo the credentials that were just posted.
    const body = redactSecrets(await res.text().catch(() => '')).slice(0, 300)
    console.error(`[oauth] Token refresh failed for ${provider}: ${res.status} ${body}`)
    return null
  }

  const data = (await res.json()) as TokenResponse
  const expiresAt = new Date(Date.now() + data.expires_in * 1000)

  await upsertOAuthToken(db, {
    userId,
    provider,
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? token.refreshToken,
    expiresAt,
    // Preserve credentials and scopes so the row stays whole after refresh.
    // decryptOAuthRow has already decrypted these on the read path.
    clientId: token.clientId,
    clientSecret: token.clientSecret,
    scopes: token.scopes,
  })

  return data.access_token
}
