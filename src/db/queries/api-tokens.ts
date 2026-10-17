import { createHash, randomBytes } from 'node:crypto'
import { and, desc, eq, isNull, lt, or } from 'drizzle-orm'
import type { Database } from '@/db'
import { type ApiTokenScope, apiTokens, users } from '@/db/schema'

export function hashApiToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

const publicColumns = {
  id: apiTokens.id,
  name: apiTokens.name,
  prefix: apiTokens.prefix,
  scope: apiTokens.scope,
  createdAt: apiTokens.createdAt,
  lastUsedAt: apiTokens.lastUsedAt,
  expiresAt: apiTokens.expiresAt,
}

export function apiTokenQueries(db: Database) {
  return {
    async create(userId: number, name: string, scope: ApiTokenScope, expiresAt: Date | null) {
      const token = `dga_${randomBytes(32).toString('base64url')}`
      const [row] = await db
        .insert(apiTokens)
        .values({
          userId,
          name,
          scope,
          expiresAt,
          tokenHash: hashApiToken(token),
          prefix: token.slice(0, 8),
        })
        .returning(publicColumns)
      if (!row) throw new Error('API token insert returned no row')
      return { ...row, token }
    },
    list(userId: number) {
      return db
        .select(publicColumns)
        .from(apiTokens)
        .where(eq(apiTokens.userId, userId))
        .orderBy(desc(apiTokens.createdAt), desc(apiTokens.id))
    },
    async revoke(userId: number, id: number) {
      const rows = await db
        .delete(apiTokens)
        .where(and(eq(apiTokens.id, id), eq(apiTokens.userId, userId)))
        .returning({ id: apiTokens.id })
      return rows.length > 0
    },
    async resolve(token: string) {
      if (!/^dga_[A-Za-z0-9_-]{43}$/.test(token)) return null
      const [row] = await db
        .select({
          id: apiTokens.id,
          userId: apiTokens.userId,
          scope: apiTokens.scope,
          expiresAt: apiTokens.expiresAt,
          lastUsedAt: apiTokens.lastUsedAt,
        })
        .from(apiTokens)
        .innerJoin(users, eq(users.id, apiTokens.userId))
        .where(eq(apiTokens.tokenHash, hashApiToken(token)))
        .limit(1)
      const now = new Date()
      if (!row || (row.expiresAt && row.expiresAt <= now)) return null
      const cutoff = new Date(now.getTime() - 60_000)
      if (!row.lastUsedAt || row.lastUsedAt < cutoff) {
        await db
          .update(apiTokens)
          .set({ lastUsedAt: now })
          .where(
            and(
              eq(apiTokens.id, row.id),
              or(isNull(apiTokens.lastUsedAt), lt(apiTokens.lastUsedAt, cutoff)),
            ),
          )
      }
      return { userId: row.userId, scope: row.scope }
    },
  }
}
