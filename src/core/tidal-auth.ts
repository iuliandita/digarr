import type { Database } from '@/db'
import { getOAuthToken } from '@/db/queries/oauth-tokens'
import { getValidToken } from './oauth'

const TIDAL_TOKEN_ENDPOINT = 'https://auth.tidal.com/v1/oauth2/token'

/**
 * Resolve a valid TIDAL user access token, refreshing when it is close to expiry.
 * Throws if the user has not completed the PKCE connect flow.
 */
export async function resolveTidalToken(db: Database, userId: number): Promise<string> {
  const row = await getOAuthToken(db, userId, 'tidal')
  if (!row || row.accessToken.startsWith('pending:')) {
    throw new Error('No TIDAL OAuth token - connect TIDAL in Settings')
  }
  if (row.clientId && row.clientSecret) {
    const token = await getValidToken(db, userId, 'tidal', {
      tokenEndpoint: TIDAL_TOKEN_ENDPOINT,
      clientId: row.clientId,
      clientSecret: row.clientSecret,
    })
    if (!token) throw new Error('TIDAL OAuth token expired and could not be refreshed')
    return token
  }
  return row.accessToken
}
