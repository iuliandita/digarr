// @vitest-environment node

import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Database } from '@/db'
import { hashSessionToken } from '@/db/queries/sessions'
import {
  fingerprintPasswordHash,
  linkOidcIdentity,
  OidcIdentityInUseError,
  OidcLinkConflictError,
} from '@/db/queries/users'
import { sessions, users } from '@/db/schema'

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

const { Pool } = pg
const POSTGRES_URL = process.env.DATABASE_URL
const LOCK_WAIT_TIMEOUT_MS = 5_000

let setupPool: pg.Pool
let setupDb: Database

describe.runIf(Boolean(POSTGRES_URL))('linkOidcIdentity PostgreSQL concurrency', () => {
  beforeAll(() => {
    if (!POSTGRES_URL) throw new Error('DATABASE_URL is required')
    setupPool = new Pool({ connectionString: POSTGRES_URL, max: 6 })
    setupDb = drizzle(setupPool, { schema: { sessions, users } }) as unknown as Database
  })

  afterAll(async () => {
    await setupPool?.end()
  })

  async function createUserWithSession(expiresAt = new Date(Date.now() + 60_000)) {
    const suffix = randomUUID()
    const passwordHash = `password-hash-${suffix}`
    const token = `session-${suffix}`
    const [user] = await setupDb
      .insert(users)
      .values({ username: `oidc-link-${suffix}`, passwordHash, authProvider: 'local' })
      .returning({ id: users.id })
    if (!user) throw new Error('test user was not created')
    await setupDb.insert(sessions).values({
      token: hashSessionToken(token),
      userId: user.id,
      expiresAt,
    })
    return { userId: user.id, passwordHash, token, expiresAt }
  }

  async function cleanupUsers(userIds: number[]) {
    if (userIds.length > 0) await setupDb.delete(users).where(inArray(users.id, userIds))
  }

  function createNamedDb(label: string) {
    if (!POSTGRES_URL) throw new Error('DATABASE_URL is required')
    const applicationName = `${label}-${randomUUID()}`
    const pool = new Pool({
      connectionString: POSTGRES_URL,
      max: 1,
      application_name: applicationName,
    })
    const db = drizzle(pool, { schema: { sessions, users } }) as unknown as Database
    return { applicationName, db, pool }
  }

  async function waitForLock(applicationName: string, blockerPid: number) {
    const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS
    while (Date.now() < deadline) {
      const result = await setupPool.query<{
        blockers: number[]
        state: string
        wait_event_type: string | null
      }>(
        `SELECT pg_blocking_pids(pid) AS blockers, state, wait_event_type
         FROM pg_stat_activity
         WHERE application_name = $1`,
        [applicationName],
      )
      if (
        result.rows.some(
          (row) =>
            row.state === 'active' &&
            row.wait_event_type === 'Lock' &&
            row.blockers.includes(blockerPid),
        )
      ) {
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    throw new Error(`${applicationName} did not enter the expected lock wait`)
  }

  function linkParams(
    fixture: Awaited<ReturnType<typeof createUserWithSession>>,
    oidcSubject: string,
  ) {
    const sessionHash = hashSessionToken(fixture.token)
    return {
      userId: fixture.userId,
      oidcSubject,
      passwordFingerprint: fingerprintPasswordHash(fixture.passwordHash),
      initiatingSessionHash: sessionHash,
      presentedSessionHash: sessionHash,
    }
  }

  it('allows exactly one of two users to claim the same subject', async () => {
    const first = await createUserWithSession()
    const second = await createUserWithSession()
    const workerA = createNamedDb('oidc-link-unique-a')
    const workerB = createNamedDb('oidc-link-unique-b')
    const sharedSubject = `shared-subject-${randomUUID()}`

    try {
      const outcomes = await Promise.allSettled([
        linkOidcIdentity(workerA.db, linkParams(first, sharedSubject)),
        linkOidcIdentity(workerB.db, linkParams(second, sharedSubject)),
      ])

      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
      const rejected = outcomes.find(
        (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
      )
      expect(rejected?.reason).toBeInstanceOf(OidcIdentityInUseError)
      const owners = await setupDb
        .select({ id: users.id })
        .from(users)
        .where(eq(users.oidcSubject, sharedSubject))
      expect(owners).toHaveLength(1)
    } finally {
      await Promise.all([workerA.pool.end(), workerB.pool.end()])
      await cleanupUsers([first.userId, second.userId])
    }
  })

  it('rejects linking after a concurrent logout commits', async () => {
    if (!POSTGRES_URL) throw new Error('DATABASE_URL is required')
    const fixture = await createUserWithSession()
    const worker = createNamedDb('oidc-link-logout')
    const blocker = await setupPool.connect()
    let transactionOpen = false
    let operation: Promise<void> | undefined

    try {
      await blocker.query('BEGIN')
      transactionOpen = true
      await blocker.query('DELETE FROM sessions WHERE token = $1', [
        hashSessionToken(fixture.token),
      ])
      const pid = Number((await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0]?.pid)

      operation = linkOidcIdentity(worker.db, linkParams(fixture, 'logout-subject'))
      void operation.catch(() => undefined)
      await waitForLock(worker.applicationName, pid)
      await blocker.query('COMMIT')
      transactionOpen = false

      await expect(operation).rejects.toBeInstanceOf(OidcLinkConflictError)
    } finally {
      if (transactionOpen) await blocker.query('ROLLBACK')
      await operation?.catch(() => undefined)
      blocker.release()
      await worker.pool.end()
      await cleanupUsers([fixture.userId])
    }
  })

  it('rejects linking after a concurrent password change commits', async () => {
    const fixture = await createUserWithSession()
    const worker = createNamedDb('oidc-link-password')
    const blocker = await setupPool.connect()
    let transactionOpen = false
    let operation: Promise<void> | undefined

    try {
      await blocker.query('BEGIN')
      transactionOpen = true
      await blocker.query('UPDATE users SET password_hash = $1 WHERE id = $2', [
        'changed-password-hash',
        fixture.userId,
      ])
      const pid = Number((await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0]?.pid)

      operation = linkOidcIdentity(worker.db, linkParams(fixture, 'password-subject'))
      void operation.catch(() => undefined)
      await waitForLock(worker.applicationName, pid)
      await blocker.query('COMMIT')
      transactionOpen = false

      await expect(operation).rejects.toBeInstanceOf(OidcLinkConflictError)
    } finally {
      if (transactionOpen) await blocker.query('ROLLBACK')
      await operation?.catch(() => undefined)
      blocker.release()
      await worker.pool.end()
      await cleanupUsers([fixture.userId])
    }
  })

  it('rejects a session that expires while waiting for its row lock', async () => {
    const expiresAt = new Date(Date.now() + 1_000)
    const fixture = await createUserWithSession(expiresAt)
    const worker = createNamedDb('oidc-link-expiry')
    const blocker = await setupPool.connect()
    let transactionOpen = false
    let operation: Promise<void> | undefined

    try {
      await blocker.query('BEGIN')
      transactionOpen = true
      await blocker.query('SELECT token FROM sessions WHERE token = $1 FOR UPDATE', [
        hashSessionToken(fixture.token),
      ])
      const pid = Number((await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0]?.pid)

      operation = linkOidcIdentity(worker.db, linkParams(fixture, 'expiry-subject'))
      void operation.catch(() => undefined)
      await waitForLock(worker.applicationName, pid)
      const waitMs = Math.max(0, expiresAt.getTime() - Date.now() + 50)
      await new Promise((resolve) => setTimeout(resolve, waitMs))
      await blocker.query('COMMIT')
      transactionOpen = false

      await expect(operation).rejects.toBeInstanceOf(OidcLinkConflictError)
    } finally {
      if (transactionOpen) await blocker.query('ROLLBACK')
      await operation?.catch(() => undefined)
      blocker.release()
      await worker.pool.end()
      await cleanupUsers([fixture.userId])
    }
  })
})
