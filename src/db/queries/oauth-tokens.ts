import { and, eq } from 'drizzle-orm'
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
  const values = {
    ...data,
    accessToken: encryptField(data.accessToken) ?? data.accessToken,
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

export async function deleteOAuthToken(
  db: Database,
  userId: number,
  provider: string,
): Promise<void> {
  await db
    .delete(oauthTokens)
    .where(and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, provider)))
}
