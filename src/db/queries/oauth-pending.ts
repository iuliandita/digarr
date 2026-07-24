import { createHash, timingSafeEqual } from 'node:crypto'
import { and, eq, lt } from 'drizzle-orm'
import { decryptField, encryptField } from '@/core/crypto'
import type { Database } from '@/db'
import { oauthPendingAuths } from '@/db/schema'

export const PENDING_OAUTH_TTL_MS = 10 * 60 * 1000

type PendingRow = typeof oauthPendingAuths.$inferSelect

/** Provider-specific data the callback needs to finish the exchange. */
export type PendingOAuthPayload = {
  redirectUri?: string
  codeVerifier?: string
}

export type PendingOAuth = {
  userId: number
  provider: string
  bindingHash: string
  payload: PendingOAuthPayload
  scopes: string | null
  clientId: string | null
  clientSecret: string | null
  expiresAt: Date
}

/** SHA-256 hex. The raw state and browser binding are bearer values; only digests are stored. */
export function hashOAuthValue(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function pendingBindingMatches(bindingHash: string, binding: string | undefined): boolean {
  if (!binding) return false
  const expected = Buffer.from(bindingHash, 'utf8')
  const actual = Buffer.from(hashOAuthValue(binding), 'utf8')
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function parsePayload(raw: string | null): PendingOAuthPayload {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as PendingOAuthPayload
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function toPendingOAuth(row: PendingRow): PendingOAuth {
  return {
    userId: row.userId,
    provider: row.provider,
    bindingHash: row.bindingHash,
    payload: parsePayload(decryptField(row.payload) ?? row.payload),
    scopes: row.scopes,
    clientId: row.clientId,
    clientSecret: decryptField(row.clientSecret) ?? row.clientSecret,
    expiresAt: row.expiresAt,
  }
}

/**
 * Start a pending authorization, replacing any earlier in-flight attempt for the
 * same user and provider so abandoned flows cannot accumulate.
 */
export async function createPendingOAuth(
  db: Database,
  params: {
    userId: number
    provider: string
    state: string
    binding: string
    payload?: PendingOAuthPayload
    scopes?: string | null
    clientId?: string | null
    clientSecret?: string | null
    ttlMs?: number
  },
): Promise<void> {
  const payload = params.payload ? JSON.stringify(params.payload) : null
  await db.transaction(async (tx) => {
    await tx
      .delete(oauthPendingAuths)
      .where(
        and(
          eq(oauthPendingAuths.userId, params.userId),
          eq(oauthPendingAuths.provider, params.provider),
        ),
      )
    await tx.insert(oauthPendingAuths).values({
      userId: params.userId,
      provider: params.provider,
      stateHash: hashOAuthValue(params.state),
      bindingHash: hashOAuthValue(params.binding),
      payload: encryptField(payload) ?? null,
      scopes: params.scopes ?? null,
      clientId: params.clientId ?? null,
      clientSecret: encryptField(params.clientSecret ?? null) ?? null,
      expiresAt: new Date(Date.now() + (params.ttlMs ?? PENDING_OAUTH_TTL_MS)),
    })
  })
}

/**
 * Redeem a pending authorization. The row is deleted as it is read, so a state
 * is single-use whether or not the exchange that follows succeeds. Expiry is the
 * caller's check - an expired row still comes back so the callback can report it.
 */
export async function consumePendingOAuth(
  db: Database,
  provider: string,
  state: string,
): Promise<PendingOAuth | null> {
  const [row] = await db
    .delete(oauthPendingAuths)
    .where(
      and(
        eq(oauthPendingAuths.provider, provider),
        eq(oauthPendingAuths.stateHash, hashOAuthValue(state)),
      ),
    )
    .returning()
  return row ? toPendingOAuth(row) : null
}

export async function deleteExpiredPendingOAuth(db: Database): Promise<void> {
  await db.delete(oauthPendingAuths).where(lt(oauthPendingAuths.expiresAt, new Date()))
}
