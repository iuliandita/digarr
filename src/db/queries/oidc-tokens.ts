import { eq } from 'drizzle-orm'
import { decryptFields, encryptFields, SENSITIVE_OIDC } from '@/core/crypto'
import type { Database } from '@/db'
import { oidcTokens } from '@/db/schema'

export type OidcTokenRow = typeof oidcTokens.$inferSelect

export type OidcTokenInsert = {
  userId: number
  issuerUrl: string
  accessToken: string
  refreshToken?: string | null
  idToken?: string | null
  expiresAt: Date
  nonce?: string | null
}

// All OIDC token read/write paths must go through this module so that
// accessToken, refreshToken, and idToken are never persisted in plaintext.
// The crypto round-trip is transparent: decryptField() passes plaintext
// through unchanged (pre-migration values) and throws on wrong key.

export async function getOidcTokensByUserId(
  db: Database,
  userId: number,
): Promise<OidcTokenRow | null> {
  const rows = await db.select().from(oidcTokens).where(eq(oidcTokens.userId, userId)).limit(1)
  const row = rows[0]
  return row ? decryptFields(row, SENSITIVE_OIDC) : null
}

export async function upsertOidcTokens(db: Database, data: OidcTokenInsert): Promise<void> {
  const encrypted = encryptFields(
    {
      userId: data.userId,
      issuerUrl: data.issuerUrl,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken ?? null,
      idToken: data.idToken ?? null,
      expiresAt: data.expiresAt,
      nonce: data.nonce ?? null,
    },
    SENSITIVE_OIDC,
  )

  await db
    .insert(oidcTokens)
    .values(encrypted)
    .onConflictDoUpdate({
      target: oidcTokens.userId,
      set: {
        issuerUrl: encrypted.issuerUrl,
        accessToken: encrypted.accessToken,
        refreshToken: encrypted.refreshToken,
        idToken: encrypted.idToken,
        expiresAt: encrypted.expiresAt,
        nonce: encrypted.nonce,
        updatedAt: new Date(),
      },
    })
}

export async function deleteOidcTokensByUserId(db: Database, userId: number): Promise<void> {
  await db.delete(oidcTokens).where(eq(oidcTokens.userId, userId))
}
