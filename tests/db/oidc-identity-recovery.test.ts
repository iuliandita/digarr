// @vitest-environment node

import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from '@/db'
import {
  createUser,
  getUserByOidcIdentity,
  OidcIdentityInUseError,
  OidcLinkConflictError,
  recoverLegacyOidcBinding,
} from '@/db/queries/users'
import { sessions, users } from '@/db/schema'
import { parseRecoveryArgs } from '../../scripts/recover-oidc-binding'
import { makeTestDb } from '../helpers/test-db'

const ISSUER = 'https://issuer.example/realm/'

describe('OIDC issuer identity and legacy recovery', () => {
  let db: Database
  let close: () => Promise<void>

  beforeAll(async () => {
    const fixture = await makeTestDb()
    db = fixture.db as unknown as Database
    close = fixture.close
  })
  beforeEach(async () => {
    await db.delete(users)
  })
  afterAll(async () => {
    await close()
  })

  async function legacyUser() {
    const [user] = await db
      .insert(users)
      .values({
        username: 'legacy',
        passwordHash: 'unchanged',
        isAdmin: true,
        oidcSubject: 'subject',
        authProvider: 'oidc',
        email: 'legacy@example.com',
      })
      .returning()
    if (!user) throw new Error('legacy fixture missing')
    return user
  }

  it('matches issuer and subject exactly and permits the same subject under another issuer', async () => {
    const first = await createUser(db, {
      username: 'one',
      passwordHash: '',
      authProvider: 'oidc',
      oidcIssuer: ISSUER,
      oidcSubject: 'shared',
    })
    const second = await createUser(db, {
      username: 'two',
      passwordHash: '',
      authProvider: 'oidc',
      oidcIssuer: `${ISSUER}other`,
      oidcSubject: 'shared',
    })
    expect((await getUserByOidcIdentity(db, ISSUER, 'shared'))?.id).toBe(first.id)
    expect((await getUserByOidcIdentity(db, `${ISSUER}other`, 'shared'))?.id).toBe(second.id)
    expect(await getUserByOidcIdentity(db, ISSUER.slice(0, -1), 'shared')).toBeNull()
    expect(await getUserByOidcIdentity(db, ISSUER, 'Shared')).toBeNull()
    await expect(
      createUser(db, {
        username: 'duplicate',
        passwordHash: '',
        oidcIssuer: ISSUER,
        oidcSubject: 'shared',
      }),
    ).rejects.toThrow()
    await legacyUser()
    expect(await getUserByOidcIdentity(db, ISSUER, 'subject')).toBeNull()
  })

  it('rejects incomplete new identities while allowing local users', async () => {
    for (const identity of [
      { oidcSubject: 'subject' },
      { oidcIssuer: ISSUER },
      { oidcIssuer: '', oidcSubject: 'subject' },
      { oidcIssuer: ISSUER, oidcSubject: ' ' },
      { authProvider: 'oidc' },
    ]) {
      await expect(
        createUser(db, { username: 'invalid', passwordHash: 'hash', ...identity }),
      ).rejects.toThrow()
    }
    const local = await createUser(db, { username: 'local', passwordHash: 'hash' })
    expect(local.oidcIssuer).toBeNull()
    expect(local.oidcSubject).toBeNull()
    await expect(
      db.update(users).set({ oidcIssuer: ISSUER }).where(eq(users.id, local.id)),
    ).rejects.toThrow()
  })

  it('defaults to dry run and applies only the historical issuer without changing account or sessions', async () => {
    const user = await legacyUser()
    await db.insert(sessions).values({
      token: 'unchanged-session',
      userId: user.id,
      expiresAt: new Date(Date.now() + 60000),
    })
    const originalSessions = await db.select().from(sessions)
    const params = { userId: user.id, subject: 'subject', issuer: ISSUER }
    expect(await recoverLegacyOidcBinding(db, params)).toEqual({ ...params, applied: false })
    expect((await db.select().from(users))[0]).toEqual(user)
    expect(await recoverLegacyOidcBinding(db, { ...params, apply: true })).toEqual({
      ...params,
      applied: true,
    })
    expect((await db.select().from(users))[0]).toEqual({ ...user, oidcIssuer: ISSUER })
    expect(await db.select().from(sessions)).toEqual(originalSessions)
    await expect(recoverLegacyOidcBinding(db, { ...params, apply: true })).rejects.toBeInstanceOf(
      OidcLinkConflictError,
    )
  })

  it('rejects stale selections and existing identity conflicts in dry run and apply', async () => {
    const user = await legacyUser()
    const params = { userId: user.id, subject: 'subject', issuer: ISSUER }
    for (const selection of [{ userId: user.id + 1000 }, { subject: 'different' }]) {
      await expect(
        recoverLegacyOidcBinding(db, { ...params, ...selection, apply: true }),
      ).rejects.toBeInstanceOf(OidcLinkConflictError)
    }
    await createUser(db, {
      username: 'owner',
      passwordHash: '',
      oidcIssuer: ISSUER,
      oidcSubject: 'subject',
    })
    for (const apply of [false, true]) {
      await expect(recoverLegacyOidcBinding(db, { ...params, apply })).rejects.toBeInstanceOf(
        OidcIdentityInUseError,
      )
    }
    expect((await db.select().from(users).where(eq(users.id, user.id)))[0]).toEqual(user)
  })

  it('rejects invalid recovery input before modifying the selected account', async () => {
    const user = await legacyUser()
    const params = { userId: user.id, subject: 'subject', issuer: ISSUER, apply: true }
    for (const invalid of [
      { userId: 0 },
      { subject: '' },
      { issuer: '' },
      { issuer: 'invalid' },
      { issuer: 'ftp://issuer.example' },
      { issuer: `${ISSUER}?query=1` },
      { issuer: `${ISSUER}#fragment` },
      { issuer: ` ${ISSUER}` },
      { issuer: 'https://user:secret@issuer.example' },
      { issuer: 'https:issuer.example' },
      { issuer: 'https://issuer.example/with space' },
      { issuer: 'https://issuer.example?' },
      { issuer: 'https://issuer.example#' },
    ]) {
      await expect(recoverLegacyOidcBinding(db, { ...params, ...invalid })).rejects.toThrow()
    }
    expect((await db.select().from(users))[0]).toEqual(user)
  })
})

describe('recovery CLI arguments', () => {
  it('requires an explicit selected user, subject and issuer and defaults to dry run', () => {
    const flags = ['--user-id', '12', '--subject', ' subject ', '--issuer', ISSUER]
    expect(parseRecoveryArgs(flags)).toEqual({
      userId: 12,
      subject: ' subject ',
      issuer: ISSUER,
      apply: false,
    })
    expect(parseRecoveryArgs([...flags, '--apply']).apply).toBe(true)
    expect(
      parseRecoveryArgs(['--user-id', '12', '--subject', '--help', '--issuer', ISSUER]).subject,
    ).toBe('--help')
    for (const args of [
      [],
      ['--user-id', '0'],
      [...flags, '--unknown'],
      [...flags, '--apply', '--apply'],
      [...flags, '--subject', 'override'],
    ]) {
      expect(() => parseRecoveryArgs(args)).toThrow('Usage:')
    }
  })
})
