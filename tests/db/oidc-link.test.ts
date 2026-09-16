// @vitest-environment node

import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from '@/db'
import { hashSessionToken } from '@/db/queries/sessions'
import {
  fingerprintPasswordHash,
  getUserCredentialsById,
  linkOidcIdentity,
  OidcIdentityInUseError,
  OidcLinkConflictError,
} from '@/db/queries/users'
import { sessions, users } from '@/db/schema'
import { makeTestDb } from '../helpers/test-db'

describe('linkOidcIdentity', () => {
  let db: Database
  let close: () => Promise<void>

  beforeEach(async () => {
    const testDb = await makeTestDb()
    db = testDb.db as unknown as Database
    close = testDb.close
  })

  afterEach(async () => {
    await close()
  })

  async function createLocalUser(username: string, passwordHash = 'password-hash') {
    const [user] = await db
      .insert(users)
      .values({
        username,
        passwordHash,
        isAdmin: true,
        email: `${username}@example.com`,
        authProvider: 'local',
        listenbrainzUsername: `${username}-listenbrainz`,
      })
      .returning()
    if (!user) throw new Error('test user was not created')
    return user
  }

  async function createActiveSession(userId: number, token: string) {
    await db.insert(sessions).values({
      token: hashSessionToken(token),
      userId,
      expiresAt: new Date(Date.now() + 60_000),
    })
  }

  it('returns only the fields needed to initiate a link', async () => {
    const user = await createLocalUser('alice')

    await expect(getUserCredentialsById(db, user.id)).resolves.toEqual({
      id: user.id,
      passwordHash: user.passwordHash,
      authProvider: 'local',
      oidcSubject: null,
    })
  })

  it('updates only the OIDC subject for the initiating local account', async () => {
    const user = await createLocalUser('alice')
    await createActiveSession(user.id, 'alice-session')

    await linkOidcIdentity(db, {
      userId: user.id,
      oidcSubject: 'oidc-alice',
      passwordFingerprint: fingerprintPasswordHash(user.passwordHash),
      initiatingSessionHash: hashSessionToken('alice-session'),
      presentedSessionHash: hashSessionToken('alice-session'),
    })

    const [linked] = await db.select().from(users).where(eq(users.id, user.id))
    expect(linked).toEqual({ ...user, oidcSubject: 'oidc-alice' })
  })

  it('rejects when the password changed after initiation', async () => {
    const user = await createLocalUser('alice')
    await createActiveSession(user.id, 'alice-session')
    await db.update(users).set({ passwordHash: 'new-password-hash' }).where(eq(users.id, user.id))

    await expect(
      linkOidcIdentity(db, {
        userId: user.id,
        oidcSubject: 'oidc-alice',
        passwordFingerprint: fingerprintPasswordHash(user.passwordHash),
        initiatingSessionHash: hashSessionToken('alice-session'),
        presentedSessionHash: hashSessionToken('alice-session'),
      }),
    ).rejects.toBeInstanceOf(OidcLinkConflictError)
  })

  it('rejects a replaced browser session and a logged-out initiating session', async () => {
    const user = await createLocalUser('alice')
    await createActiveSession(user.id, 'alice-session')
    const params = {
      userId: user.id,
      oidcSubject: 'oidc-alice',
      passwordFingerprint: fingerprintPasswordHash(user.passwordHash),
      initiatingSessionHash: hashSessionToken('alice-session'),
      presentedSessionHash: hashSessionToken('different-session'),
    }

    await expect(linkOidcIdentity(db, params)).rejects.toBeInstanceOf(OidcLinkConflictError)

    await db.delete(sessions).where(eq(sessions.token, hashSessionToken('alice-session')))
    await expect(
      linkOidcIdentity(db, {
        ...params,
        presentedSessionHash: hashSessionToken('alice-session'),
      }),
    ).rejects.toBeInstanceOf(OidcLinkConflictError)
  })

  it('rejects a session owned by another user', async () => {
    const alice = await createLocalUser('alice')
    const bob = await createLocalUser('bob')
    await createActiveSession(bob.id, 'shared-browser-session')

    await expect(
      linkOidcIdentity(db, {
        userId: alice.id,
        oidcSubject: 'oidc-alice',
        passwordFingerprint: fingerprintPasswordHash(alice.passwordHash),
        initiatingSessionHash: hashSessionToken('shared-browser-session'),
        presentedSessionHash: hashSessionToken('shared-browser-session'),
      }),
    ).rejects.toBeInstanceOf(OidcLinkConflictError)
  })

  it('rejects an expired initiating session', async () => {
    const user = await createLocalUser('alice')
    await db.insert(sessions).values({
      token: hashSessionToken('expired-session'),
      userId: user.id,
      expiresAt: new Date(Date.now() - 1_000),
    })

    await expect(
      linkOidcIdentity(db, {
        userId: user.id,
        oidcSubject: 'oidc-alice',
        passwordFingerprint: fingerprintPasswordHash(user.passwordHash),
        initiatingSessionHash: hashSessionToken('expired-session'),
        presentedSessionHash: hashSessionToken('expired-session'),
      }),
    ).rejects.toBeInstanceOf(OidcLinkConflictError)
  })

  it('maps a unique subject collision to the fixed identity-in-use error', async () => {
    const alice = await createLocalUser('alice')
    const bob = await createLocalUser('bob')
    await db.update(users).set({ oidcSubject: 'claimed-subject' }).where(eq(users.id, bob.id))
    await createActiveSession(alice.id, 'alice-session')

    await expect(
      linkOidcIdentity(db, {
        userId: alice.id,
        oidcSubject: 'claimed-subject',
        passwordFingerprint: fingerprintPasswordHash(alice.passwordHash),
        initiatingSessionHash: hashSessionToken('alice-session'),
        presentedSessionHash: hashSessionToken('alice-session'),
      }),
    ).rejects.toBeInstanceOf(OidcIdentityInUseError)

    const [unchanged] = await db.select().from(users).where(eq(users.id, alice.id))
    expect(unchanged?.oidcSubject).toBeNull()
  })
})
