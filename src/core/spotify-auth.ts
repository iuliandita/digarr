import type { Database } from '@/db'
import { getOAuthToken } from '@/db/queries/oauth-tokens'
import { getValidToken } from './oauth'

const SPOTIFY_TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token'

/**
 * Resolve a valid Spotify access token for the given user.
 * Refreshes via client credentials if available, otherwise returns the stored token.
 * Throws if no token exists or the token is in pending OAuth state.
 */
export async function resolveSpotifyToken(db: Database, userId: number): Promise<string> {
  const row = await getOAuthToken(db, userId, 'spotify')
  if (!row || row.accessToken.startsWith('pending:')) {
    throw new Error('No Spotify OAuth token - connect Spotify in Settings')
  }
  if (row.clientId && row.clientSecret) {
    const token = await getValidToken(db, userId, 'spotify', {
      tokenEndpoint: SPOTIFY_TOKEN_ENDPOINT,
      clientId: row.clientId,
      clientSecret: row.clientSecret,
    })
    if (!token) throw new Error('Spotify OAuth token expired and could not be refreshed')
    return token
  }
  return row.accessToken
}
