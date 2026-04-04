import { createHash } from 'node:crypto'
import { and, eq, gt, lt } from 'drizzle-orm'
import type { Database } from '@/db'
import { sessions } from '../schema'

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** Hash a session token before storage/lookup so plaintext tokens never touch the DB. */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function sessionQueries(db: Database) {
  return {
    async create(token: string, userId: number): Promise<void> {
      const hashed = hashSessionToken(token)
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
      await db.insert(sessions).values({ token: hashed, userId, expiresAt }).onConflictDoUpdate({
        target: sessions.token,
        set: { userId, expiresAt },
      })
    },

    async get(token: string): Promise<{ userId: number } | null> {
      const hashed = hashSessionToken(token)
      const [row] = await db
        .select({ userId: sessions.userId })
        .from(sessions)
        .where(and(eq(sessions.token, hashed), gt(sessions.expiresAt, new Date())))
        .limit(1)
      return row ?? null
    },

    async delete(token: string): Promise<void> {
      const hashed = hashSessionToken(token)
      await db.delete(sessions).where(eq(sessions.token, hashed))
    },

    async deleteForUser(userId: number): Promise<void> {
      await db.delete(sessions).where(eq(sessions.userId, userId))
    },

    async getActiveForUser(userId: number): Promise<string | null> {
      const [row] = await db
        .select({ token: sessions.token })
        .from(sessions)
        .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, new Date())))
        .limit(1)
      return row?.token ?? null
    },

    async deleteExpired(): Promise<void> {
      await db.delete(sessions).where(lt(sessions.expiresAt, new Date()))
    },

    async clear(): Promise<void> {
      await db.delete(sessions)
    },
  }
}

export type SessionStore = ReturnType<typeof sessionQueries>
