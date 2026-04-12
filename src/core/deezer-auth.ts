import type { Database } from '@/db'
import { getOAuthToken } from '@/db/queries/oauth-tokens'

/**
 * Resolve a stored Deezer access token for the given user.
 * Deezer tokens are long-lived and do not require refresh.
 * Throws if no token exists or the token is in pending OAuth state.
 */
export async function resolveDeezerToken(db: Database, userId: number): Promise<string> {
  const row = await getOAuthToken(db, userId, 'deezer')
  if (!row || row.accessToken.startsWith('pending:')) {
    throw new Error('No Deezer OAuth token - connect Deezer in Settings')
  }
  return row.accessToken
}
