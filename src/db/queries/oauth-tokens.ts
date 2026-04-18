import { and, eq, like } from 'drizzle-orm'
import { decryptField, encryptField } from '@/core/crypto'
import type { Database } from '@/db'
import { oauthTokens } from '@/db/schema'

type OAuthTokenRow = typeof oauthTokens.$inferSelect
type OAuthTokenInsert = typeof oauthTokens.$inferInsert

export type { OAuthTokenInsert, OAuthTokenRow }

function decryptOAuthRow(row: OAuthTokenRow): OAuthTokenRow {
  return {
    ...row,
    accessToken: decryptField(row.accessToken) ?? row.accessToken,
    refreshToken: decryptField(row.refreshToken) ?? row.refreshToken,
    clientSecret: decryptField(row.clientSecret) ?? row.clientSecret,
  }
}

export async function getOAuthToken(
  db: Database,
  userId: number,
  provider: string,
): Promise<OAuthTokenRow | null> {
  const [row] = await db
    .select()
    .from(oauthTokens)
    .where(and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, provider)))
    .limit(1)
  if (!row) return null
  return decryptOAuthRow(row)
}

export async function upsertOAuthToken(
  db: Database,
  data: OAuthTokenInsert,
): Promise<OAuthTokenRow> {
  // accessToken stays plaintext when it's a pending marker so the LIKE-prefix
  // lookup in findPendingOAuthByState can match. refreshToken and clientSecret
  // are never searched by prefix, so they must always be encrypted.
  const isPending = data.accessToken.startsWith('pending:')
  const values = {
    ...data,
    accessToken: isPending
      ? data.accessToken
      : (encryptField(data.accessToken) ?? data.accessToken),
    refreshToken: encryptField(data.refreshToken) ?? data.refreshToken,
    clientSecret: encryptField(data.clientSecret) ?? data.clientSecret,
  }
  const [row] = await db
    .insert(oauthTokens)
    .values(values)
    .onConflictDoUpdate({
      target: [oauthTokens.userId, oauthTokens.provider],
      set: {
        accessToken: values.accessToken,
        refreshToken: values.refreshToken,
        expiresAt: data.expiresAt,
        scopes: data.scopes,
        clientId: values.clientId,
        clientSecret: values.clientSecret,
        updatedAt: new Date(),
      },
    })
    .returning()
  if (!row) throw new Error('upsertOAuthToken: no row returned')
  return decryptOAuthRow(row)
}

function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

/** Find a pending OAuth token by provider and opaque state (stored as `pending:{userId}:{state}`). */
export async function findPendingOAuthByState(
  db: Database,
  provider: string,
  state: string,
): Promise<OAuthTokenRow | null> {
  // Use SQL suffix match to avoid loading all pending tokens into memory.
  // The accessToken format is `pending:{userId}:{state}`. Escape LIKE wildcards
  // so attacker-supplied `%` or `_` in state can't broaden the match.
  const pattern = `%:${escapeLikePattern(state)}`
  const rows = await db
    .select()
    .from(oauthTokens)
    .where(and(eq(oauthTokens.provider, provider), like(oauthTokens.accessToken, pattern)))
  // Verify the match is actually a pending token (not a coincidental suffix)
  const match = rows.find(
    (r) => r.accessToken.startsWith('pending:') && r.accessToken.endsWith(`:${state}`),
  )
  return match ?? null
}

export async function deleteOAuthToken(
  db: Database,
  userId: number,
  provider: string,
): Promise<void> {
  await db
    .delete(oauthTokens)
    .where(and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, provider)))
}
