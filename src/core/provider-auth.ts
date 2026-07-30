import type { Database } from '@/db'
import { getOAuthToken } from '@/db/queries/oauth-tokens'
import { getValidToken } from './oauth'

export type OAuthProvider = 'spotify' | 'deezer' | 'tidal'

/** Why a provider token could not be resolved. */
export type ProviderAuthReason = 'not_connected' | 'token_unusable'

export class ProviderAuthError extends Error {
  constructor(
    readonly provider: OAuthProvider,
    readonly reason: ProviderAuthReason,
    message: string,
  ) {
    super(message)
    this.name = 'ProviderAuthError'
  }
}

type ProviderAuthSpec = {
  /** Human-facing provider name used in error messages. */
  label: string
  /** Absent for providers whose tokens are long-lived and cannot be refreshed. */
  tokenEndpoint?: string
  authStyle?: 'basic' | 'body'
}

const PROVIDER_AUTH: Record<OAuthProvider, ProviderAuthSpec> = {
  spotify: {
    label: 'Spotify',
    tokenEndpoint: 'https://accounts.spotify.com/api/token',
    authStyle: 'body',
  },
  deezer: { label: 'Deezer' },
  tidal: {
    label: 'TIDAL',
    tokenEndpoint: 'https://auth.tidal.com/v1/oauth2/token',
    // Must match how the authorization-code exchange in the callback route
    // authenticates: a given client accepts one style, not both.
    authStyle: 'basic',
  },
}

export function providerLabel(provider: OAuthProvider): string {
  return PROVIDER_AUTH[provider].label
}

/**
 * Resolve a usable access token for a provider connection.
 * Refreshes when the provider supports it and stored credentials allow it,
 * otherwise returns the stored token.
 */
export async function resolveProviderToken(
  db: Database,
  userId: number,
  provider: OAuthProvider,
): Promise<string> {
  const spec = PROVIDER_AUTH[provider]
  const row = await getOAuthToken(db, userId, provider)
  if (!row || row.accessToken.startsWith('pending:')) {
    throw new ProviderAuthError(
      provider,
      'not_connected',
      `No ${spec.label} OAuth token - connect ${spec.label} in Settings`,
    )
  }
  if (spec.tokenEndpoint && row.clientId && row.clientSecret) {
    const token = await getValidToken(db, userId, provider, {
      tokenEndpoint: spec.tokenEndpoint,
      clientId: row.clientId,
      clientSecret: row.clientSecret,
      authStyle: spec.authStyle,
    })
    if (!token) {
      throw new ProviderAuthError(
        provider,
        'token_unusable',
        `${spec.label} OAuth token expired and could not be refreshed`,
      )
    }
    return token
  }
  return row.accessToken
}
