import { and, eq, sql } from 'drizzle-orm'
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

/**
 * Store a refreshed token only if the row is still the generation that was
 * read before the refresh. A disconnect or reconnect in the meantime wins.
 */
export async function updateRefreshedOAuthToken(
  db: Database,
  generation: Pick<OAuthTokenRow, 'id' | 'updatedAt'>,
  data: Pick<OAuthTokenRow, 'accessToken' | 'refreshToken' | 'expiresAt'>,
): Promise<boolean> {
  const rows = await db
    .update(oauthTokens)
    .set({
      accessToken: encryptField(data.accessToken) ?? data.accessToken,
      refreshToken: encryptField(data.refreshToken) ?? data.refreshToken,
      expiresAt: data.expiresAt,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(oauthTokens.id, generation.id),
        // The JS Date read back is truncated to milliseconds; the column may hold microseconds.
        sql`date_trunc('milliseconds', ${oauthTokens.updatedAt}) = ${generation.updatedAt.toISOString()}::timestamptz`,
      ),
    )
    .returning({ id: oauthTokens.id })
  return rows.length > 0
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
