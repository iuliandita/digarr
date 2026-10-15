import { createHash, timingSafeEqual } from 'node:crypto'
import { and, count, desc, eq, isNull, lt, or, sql } from 'drizzle-orm'
import { decryptFields, encryptFields, SENSITIVE_USER_CONNECTIONS } from '@/core/crypto'
import { isUniqueViolation } from '@/core/db-errors'
import type { SupportedLocale } from '@/core/i18n/locales'
import type { Database, DbOrTx } from '@/db'
import type { Preferences } from '@/db/schema'
import { sessions, users } from '@/db/schema'
import type { Cursor } from '@/server/helpers/pagination-cursor'

type UserRow = typeof users.$inferSelect

export type UserPublic = Omit<UserRow, 'passwordHash' | 'preferredLocale'> & {
  preferredLocale?: UserRow['preferredLocale']
}

function toPublic(row: UserRow): UserPublic {
  const { passwordHash: _, ...rest } = row
  return rest
}

export type UserBootstrapOptions = { bootstrap?: 'allow-existing' | 'first-user-only' }

export class FirstUserRequiredError extends Error {
  constructor() {
    super('A user already exists')
    this.name = 'FirstUserRequiredError'
  }
}

export class LastAdminError extends Error {
  constructor() {
    super('Cannot remove the last admin user')
    this.name = 'LastAdminError'
  }
}

export class OidcLinkConflictError extends Error {
  constructor() {
    super('OIDC account link is no longer valid')
    this.name = 'OidcLinkConflictError'
  }
}

export class OidcIdentityInUseError extends Error {
  constructor() {
    super('OIDC identity is already in use')
    this.name = 'OidcIdentityInUseError'
  }
}

export type OidcLinkParams = {
  userId: number
  oidcIssuer: string
  oidcSubject: string
  passwordFingerprint: string
  initiatingSessionHash: string
  presentedSessionHash: string
}

export type OidcLinkCredentials = {
  id: number
  passwordHash: string
  authProvider: string
  oidcIssuer: string | null
  oidcSubject: string | null
}

export function fingerprintPasswordHash(passwordHash: string): string {
  return createHash('sha256').update(passwordHash).digest('hex')
}

function fingerprintsMatch(actual: string, expected: string): boolean {
  const actualDigest = createHash('sha256').update(actual).digest()
  const expectedDigest = createHash('sha256').update(expected).digest()
  return timingSafeEqual(actualDigest, expectedDigest)
}

export async function linkOidcIdentity(db: Database, params: OidcLinkParams): Promise<void> {
  validateOidcIdentity(params.oidcIssuer, params.oidcSubject)
  try {
    await db.transaction(async (tx) => {
      const [user] = await tx
        .select({
          id: users.id,
          passwordHash: users.passwordHash,
          authProvider: users.authProvider,
          oidcIssuer: users.oidcIssuer,
          oidcSubject: users.oidcSubject,
        })
        .from(users)
        .where(eq(users.id, params.userId))
        .limit(1)
        .for('update')

      if (
        user?.authProvider !== 'local' ||
        user.oidcIssuer !== null ||
        user.oidcSubject !== null ||
        !fingerprintsMatch(fingerprintPasswordHash(user.passwordHash), params.passwordFingerprint)
      ) {
        throw new OidcLinkConflictError()
      }

      const [session] = await tx
        .select({ userId: sessions.userId, expiresAt: sessions.expiresAt })
        .from(sessions)
        .where(eq(sessions.token, params.initiatingSessionHash))
        .limit(1)
        .for('update')

      if (
        !session ||
        session.userId !== params.userId ||
        session.expiresAt <= new Date() ||
        !fingerprintsMatch(params.initiatingSessionHash, params.presentedSessionHash)
      ) {
        throw new OidcLinkConflictError()
      }

      await tx
        .update(users)
        .set({ oidcIssuer: params.oidcIssuer, oidcSubject: params.oidcSubject })
        .where(eq(users.id, params.userId))
    })
  } catch (error) {
    if (isUniqueViolation(error, 'users_oidc_identity_unique_idx')) {
      throw new OidcIdentityInUseError()
    }
    throw error
  }
}

function validateOidcIdentity(issuer: unknown, subject: unknown): asserts issuer is string {
  if (
    typeof issuer !== 'string' ||
    !issuer.trim() ||
    typeof subject !== 'string' ||
    !subject.trim()
  ) {
    throw new Error('OIDC issuer and subject must both be nonempty strings')
  }
}

export type LegacyOidcBindingRecoveryParams = {
  userId: number
  subject: string
  issuer: string
  apply?: boolean
}

export async function recoverLegacyOidcBinding(
  db: Database,
  params: LegacyOidcBindingRecoveryParams,
): Promise<{ userId: number; subject: string; issuer: string; applied: boolean }> {
  validateOidcIdentity(params.issuer, params.subject)
  if (!Number.isSafeInteger(params.userId) || params.userId <= 0) {
    throw new Error('User ID must be a positive safe integer')
  }
  let issuerUrl: URL
  try {
    issuerUrl = new URL(params.issuer)
  } catch {
    throw new Error('Historical issuer must be an exact HTTP(S) issuer URL')
  }
  if (
    !/^https?:\/\//i.test(params.issuer) ||
    /[\s\\?#]/.test(params.issuer) ||
    !['https:', 'http:'].includes(issuerUrl.protocol) ||
    issuerUrl.username ||
    issuerUrl.password ||
    issuerUrl.search ||
    issuerUrl.hash ||
    params.issuer.trim() !== params.issuer
  ) {
    throw new Error(
      'Historical issuer must be an exact HTTP(S) issuer URL without credentials, query, or fragment',
    )
  }
  try {
    return await db.transaction(async (tx) => {
      const [user] = await tx
        .select({ oidcIssuer: users.oidcIssuer, oidcSubject: users.oidcSubject })
        .from(users)
        .where(eq(users.id, params.userId))
        .limit(1)
        .for('update')
      if (!user || user.oidcIssuer !== null || user.oidcSubject !== params.subject) {
        throw new OidcLinkConflictError()
      }
      const [owner] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.oidcIssuer, params.issuer), eq(users.oidcSubject, params.subject)))
        .limit(1)
      if (owner) throw new OidcIdentityInUseError()
      if (params.apply === true) {
        await tx
          .update(users)
          .set({ oidcIssuer: params.issuer })
          .where(
            and(
              eq(users.id, params.userId),
              isNull(users.oidcIssuer),
              eq(users.oidcSubject, params.subject),
            ),
          )
      }
      return {
        userId: params.userId,
        subject: params.subject,
        issuer: params.issuer,
        applied: params.apply === true,
      }
    })
  } catch (error) {
    if (isUniqueViolation(error, 'users_oidc_identity_unique_idx')) {
      throw new OidcIdentityInUseError()
    }
    throw error
  }
}

async function guardLastAdmin(tx: DbOrTx, id: number): Promise<void> {
  // Serialize admin removals with other users mutations, including bootstrap.
  await tx.execute(sql`LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE`)
  const admins = await tx.select({ id: users.id }).from(users).where(eq(users.isAdmin, true))
  if (admins.length === 1 && admins[0]?.id === id) throw new LastAdminError()
}

export async function createUser(
  db: Database,
  data: {
    username: string
    passwordHash: string
    isAdmin?: boolean
    email?: string
    oidcIssuer?: string
    oidcSubject?: string
    authProvider?: string
  },
  options: UserBootstrapOptions = {},
): Promise<UserPublic> {
  if (
    data.oidcIssuer !== undefined ||
    data.oidcSubject !== undefined ||
    data.authProvider === 'oidc'
  ) {
    validateOidcIdentity(data.oidcIssuer, data.oidcSubject)
  }
  if (options.bootstrap) {
    return db.transaction(async (tx) => {
      // Serialize first-user decisions with every concurrent users insert.
      await tx.execute(sql`LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE`)
      const [existing] = await tx.select({ id: users.id }).from(users).limit(1)
      if (existing && options.bootstrap === 'first-user-only') {
        throw new FirstUserRequiredError()
      }
      return insertUser(tx, { ...data, isAdmin: !existing })
    })
  }
  return insertUser(db, data)
}

async function insertUser(db: DbOrTx, data: Parameters<typeof createUser>[1]): Promise<UserPublic> {
  const rows = await db
    .insert(users)
    .values({
      username: data.username,
      passwordHash: data.passwordHash,
      isAdmin: data.isAdmin ?? false,
      email: data.email,
      oidcIssuer: data.oidcIssuer,
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

export async function getUserCredentialsById(
  db: Database,
  id: number,
): Promise<OidcLinkCredentials | null> {
  const rows = await db
    .select({
      id: users.id,
      passwordHash: users.passwordHash,
      authProvider: users.authProvider,
      oidcIssuer: users.oidcIssuer,
      oidcSubject: users.oidcSubject,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1)
  return rows[0] ?? null
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

export async function deleteUser(db: Database, id: number): Promise<void> {
  await db.transaction(async (tx) => {
    await guardLastAdmin(tx, id)
    await tx.delete(users).where(eq(users.id, id))
  })
}

export async function getUserByOidcIdentity(
  db: Database,
  issuer: string,
  subject: string,
): Promise<UserRow | null> {
  validateOidcIdentity(issuer, subject)
  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.oidcIssuer, issuer), eq(users.oidcSubject, subject)))
    .limit(1)
  return rows[0] ?? null
}

export async function getUserByEmail(db: Database, email: string): Promise<UserRow | null> {
  // Emails are stored lowercased; normalize the lookup so a mixed-case address
  // (e.g. from an OIDC claim) still matches and cannot be used to bypass the
  // case-sensitive unique index.
  const rows = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1)
  return rows[0] ?? null
}

export type UserConnections = {
  listenbrainzUsername: string | null
  listenbrainzToken: string | null
  lastfmUsername: string | null
  lastfmApiKey: string | null
  plexUrl: string | null
  plexToken: string | null
  plexSectionId: string | null
  plexAccountId: number | null
  plexAccountName: string | null
  plexMachineIdentifier: string | null
  jellyfinUrl: string | null
  jellyfinApiKey: string | null
  jellyfinUserId: string | null
  jellyfinLibraryId: string | null
  embyUrl: string | null
  embyApiKey: string | null
  embyUserId: string | null
  embyLibraryId: string | null
  discogsToken: string | null
  discogsUsername: string | null
  subsonicUrl: string | null
  subsonicUsername: string | null
  subsonicPassword: string | null
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
      plexSectionId: users.plexSectionId,
      plexAccountId: users.plexAccountId,
      plexAccountName: users.plexAccountName,
      plexMachineIdentifier: users.plexMachineIdentifier,
      jellyfinUrl: users.jellyfinUrl,
      jellyfinApiKey: users.jellyfinApiKey,
      jellyfinUserId: users.jellyfinUserId,
      jellyfinLibraryId: users.jellyfinLibraryId,
      embyUrl: users.embyUrl,
      embyApiKey: users.embyApiKey,
      embyUserId: users.embyUserId,
      embyLibraryId: users.embyLibraryId,
      discogsToken: users.discogsToken,
      discogsUsername: users.discogsUsername,
      subsonicUrl: users.subsonicUrl,
      subsonicUsername: users.subsonicUsername,
      subsonicPassword: users.subsonicPassword,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!row) return null
  return decryptFields(row, SENSITIVE_USER_CONNECTIONS)
}

export async function updateUserConnections(
  db: DbOrTx,
  userId: number,
  data: Partial<UserConnections>,
): Promise<void> {
  const encrypted = encryptFields(data, SENSITIVE_USER_CONNECTIONS)
  await db.update(users).set(encrypted).where(eq(users.id, userId))
}

export async function updateUser(
  db: Database,
  id: number,
  data: { isAdmin?: boolean; email?: string | null },
): Promise<void> {
  const updates = { isAdmin: data.isAdmin, email: data.email }
  if (data.isAdmin === false) {
    await db.transaction(async (tx) => {
      await guardLastAdmin(tx, id)
      await tx.update(users).set(updates).where(eq(users.id, id))
    })
    return
  }
  await db.update(users).set(updates).where(eq(users.id, id))
}
