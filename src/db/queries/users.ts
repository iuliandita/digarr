import { and, count, desc, eq, lt, or } from 'drizzle-orm'
import { decryptFields, encryptFields, SENSITIVE_USER_CONNECTIONS } from '@/core/crypto'
import type { SupportedLocale } from '@/core/i18n/locales'
import type { Database } from '@/db'
import type { Preferences } from '@/db/schema'
import { users } from '@/db/schema'
import type { Cursor } from '@/server/helpers/pagination-cursor'

type UserRow = typeof users.$inferSelect

export type UserPublic = Omit<UserRow, 'passwordHash' | 'preferredLocale'> & {
  preferredLocale?: UserRow['preferredLocale']
}

function toPublic(row: UserRow): UserPublic {
  const { passwordHash: _, ...rest } = row
  return rest
}

export async function createUser(
  db: Database,
  data: {
    username: string
    passwordHash: string
    isAdmin?: boolean
    email?: string
    oidcSubject?: string
    authProvider?: string
  },
): Promise<UserPublic> {
  const rows = await db
    .insert(users)
    .values({
      username: data.username,
      passwordHash: data.passwordHash,
      isAdmin: data.isAdmin ?? false,
      email: data.email,
      oidcSubject: data.oidcSubject,
      authProvider: data.authProvider ?? 'local',
    })
    .returning()
  const row = rows[0]
  if (!row) throw new Error('createUser: no row returned')
  return toPublic(row)
}

export async function getUserByUsername(db: Database, username: string): Promise<UserRow | null> {
  const rows = await db.select().from(users).where(eq(users.username, username)).limit(1)
  return rows[0] ?? null
}

export async function getUserById(db: Database, id: number): Promise<UserPublic | null> {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1)
  const row = rows[0]
  return row ? toPublic(row) : null
}

export async function getUserCount(db: Database): Promise<number> {
  const rows = await db.select({ total: count() }).from(users)
  return rows[0]?.total ?? 0
}

export async function updateUserPreferences(
  db: Database,
  userId: number,
  preferences: Preferences,
): Promise<void> {
  await db.update(users).set({ preferences }).where(eq(users.id, userId))
}

export async function updateUserPreferredLocale(
  db: Database,
  id: number,
  preferredLocale: SupportedLocale | null,
): Promise<void> {
  await db.update(users).set({ preferredLocale }).where(eq(users.id, id))
}

export async function listUsers(
  db: Database,
  opts: { limit?: number; cursor?: Cursor | null } = {},
): Promise<UserPublic[]> {
  const conditions = []
  if (opts.cursor) {
    conditions.push(
      or(
        lt(users.createdAt, new Date(opts.cursor.ts)),
        and(eq(users.createdAt, new Date(opts.cursor.ts)), lt(users.id, opts.cursor.id)),
      ) as NonNullable<ReturnType<typeof or>>,
    )
  }
  const base = conditions.length
    ? db
        .select()
        .from(users)
        .where(and(...conditions))
    : db.select().from(users)
  const ordered = base.orderBy(desc(users.createdAt), desc(users.id))
  const rows = await (opts.limit ? ordered.limit(opts.limit) : ordered)
  return rows.map(toPublic)
}

export async function updatePassword(
  db: Database,
  id: number,
  passwordHash: string,
): Promise<void> {
  await db.update(users).set({ passwordHash }).where(eq(users.id, id))
}

export async function deleteUser(db: Database, id: number): Promise<void> {
  await db.delete(users).where(eq(users.id, id))
}

export async function getUserByOidcSubject(db: Database, subject: string): Promise<UserRow | null> {
  const rows = await db.select().from(users).where(eq(users.oidcSubject, subject)).limit(1)
  return rows[0] ?? null
}

export async function getUserByEmail(db: Database, email: string): Promise<UserRow | null> {
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1)
  return rows[0] ?? null
}

export type UserConnections = {
  listenbrainzUsername: string | null
  listenbrainzToken: string | null
  lastfmUsername: string | null
  lastfmApiKey: string | null
  plexUrl: string | null
  plexToken: string | null
  jellyfinUrl: string | null
  jellyfinApiKey: string | null
  jellyfinUserId: string | null
  embyUrl: string | null
  embyApiKey: string | null
  embyUserId: string | null
  discogsToken: string | null
  discogsUsername: string | null
}

export async function getUserConnections(
  db: Database,
  userId: number,
): Promise<UserConnections | null> {
  const [row] = await db
    .select({
      listenbrainzUsername: users.listenbrainzUsername,
      listenbrainzToken: users.listenbrainzToken,
      lastfmUsername: users.lastfmUsername,
      lastfmApiKey: users.lastfmApiKey,
      plexUrl: users.plexUrl,
      plexToken: users.plexToken,
      jellyfinUrl: users.jellyfinUrl,
      jellyfinApiKey: users.jellyfinApiKey,
      jellyfinUserId: users.jellyfinUserId,
      embyUrl: users.embyUrl,
      embyApiKey: users.embyApiKey,
      embyUserId: users.embyUserId,
      discogsToken: users.discogsToken,
      discogsUsername: users.discogsUsername,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!row) return null
  return decryptFields(row, SENSITIVE_USER_CONNECTIONS)
}

export async function updateUserConnections(
  db: Database,
  userId: number,
  data: Partial<UserConnections>,
): Promise<void> {
  const encrypted = encryptFields(data, SENSITIVE_USER_CONNECTIONS)
  await db.update(users).set(encrypted).where(eq(users.id, userId))
}

export async function updateUser(
  db: Database,
  id: number,
  data: { isAdmin?: boolean; email?: string; oidcSubject?: string; authProvider?: string },
): Promise<void> {
  await db.update(users).set(data).where(eq(users.id, id))
}
