// @vitest-environment node

import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '@/db'
import {
  hashSessionToken,
  PasswordCredentialConflictError,
  SessionRotationConflictError,
  sessionQueries,
} from '@/db/queries/sessions'
import { sessions, users } from '@/db/schema'
import { makeTestDb } from '../helpers/test-db'

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

const { Pool } = pg
const POSTGRES_URL = process.env.DATABASE_URL
const POSTGRES_WAIT_TIMEOUT_MS = 5_000

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

async function createUser(username: string): Promise<number> {
  const [user] = await db
    .insert(users)
    .values({ username, passwordHash: 'test-password-hash' })
    .returning({ id: users.id })
  if (!user) throw new Error('test user was not created')
  return user.id
}

type BackendWait = {
  application_name: string
  blockers: number[]
  state: string
  wait_event_type: string | null
}

async function readNamedBackendWaits(
  observerPool: pg.Pool,
  applicationNames: string[],
): Promise<BackendWait[]> {
  const result = await observerPool.query<BackendWait>(
    `SELECT application_name, pg_blocking_pids(pid) AS blockers, state, wait_event_type
     FROM pg_stat_activity
     WHERE application_name = ANY($1::text[])`,
    [applicationNames],
  )
  return result.rows
}

async function waitForNamedBackendsBlockedBy(
  observerPool: pg.Pool,
  applicationNames: string[],
  blockerPid: number,
): Promise<void> {
  const deadline = Date.now() + POSTGRES_WAIT_TIMEOUT_MS

  while (Date.now() < deadline) {
    const rows = await readNamedBackendWaits(observerPool, applicationNames)
    const waiting = new Set(
      rows
        .filter((row) => row.state === 'active' && row.wait_event_type === 'Lock')
        .map((row) => row.application_name),
    )
    if (
      applicationNames.every((name) => waiting.has(name)) &&
      rows.some((row) => row.blockers.includes(blockerPid))
    ) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }

  throw new Error('PostgreSQL rotation backends did not both enter the expected lock queue')
}

async function waitForNamedBackendsAfterUserRelease(
  observerPool: pg.Pool,
  applicationNames: string[],
  releasedUserBlockerPid: number,
  sessionBlockerPid: number,
): Promise<void> {
  const deadline = Date.now() + POSTGRES_WAIT_TIMEOUT_MS

  while (Date.now() < deadline) {
    const rows = await readNamedBackendWaits(observerPool, applicationNames)
    const byName = new Map(rows.map((row) => [row.application_name, row]))
    const namedRows = applicationNames.map((name) => byName.get(name))
    if (
      namedRows.every(
        (row) =>
          row?.state === 'active' &&
          row.wait_event_type === 'Lock' &&
          !row.blockers.includes(releasedUserBlockerPid),
      ) &&
      namedRows.some((row) => row?.blockers.includes(sessionBlockerPid))
    ) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }

  throw new Error('PostgreSQL rotation backends did not reach the post-user-lock phase')
}

async function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), POSTGRES_WAIT_TIMEOUT_MS)
  })

  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function findPostgresErrorCode(error: unknown): string | undefined {
  const seen = new Set<object>()
  let current = error

  while (typeof current === 'object' && current !== null && !seen.has(current)) {
    seen.add(current)
    const record = current as { cause?: unknown; code?: unknown }
    if (typeof record.code === 'string') return record.code
    current = record.cause
  }
  return undefined
}

async function runRotationsBehindUserLocks(
  observerPool: pg.Pool,
  userIds: number[],
  applicationNames: string[],
  operations: [() => Promise<void>, () => Promise<void>],
  blockedSessionTokens: string[] = [],
): Promise<PromiseSettledResult<void>[]> {
  const userBlocker = await observerPool.connect()
  let sessionBlocker: pg.PoolClient | undefined
  let userBlockerOpen = false
  let sessionBlockerOpen = false
  let outcomesPromise: Promise<PromiseSettledResult<void>[]> | undefined

  try {
    if (blockedSessionTokens.length > 0) sessionBlocker = await observerPool.connect()
    let sessionBlockerPid: number | undefined
    if (sessionBlocker) {
      await sessionBlocker.query('BEGIN')
      sessionBlockerOpen = true
      const lockedSessions = await sessionBlocker.query(
        'SELECT token FROM sessions WHERE token = ANY($1::text[]) ORDER BY token FOR UPDATE',
        [blockedSessionTokens.map(hashSessionToken)],
      )
      if (lockedSessions.rowCount !== blockedSessionTokens.length) {
        throw new Error('PostgreSQL session blocker did not find every source token')
      }
      const pidResult = await sessionBlocker.query<{ pid: number }>(
        'SELECT pg_backend_pid() AS pid',
      )
      sessionBlockerPid = pidResult.rows[0]?.pid
      if (sessionBlockerPid === undefined) throw new Error('PostgreSQL session blocker has no PID')
    }

    await userBlocker.query('BEGIN')
    userBlockerOpen = true
    await userBlocker.query(
      'SELECT id FROM users WHERE id = ANY($1::integer[]) ORDER BY id FOR UPDATE',
      [userIds],
    )
    const userPidResult = await userBlocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
    const userBlockerPid = userPidResult.rows[0]?.pid
    if (userBlockerPid === undefined) throw new Error('PostgreSQL user blocker has no PID')

    outcomesPromise = Promise.allSettled(operations.map((operation) => operation()))
    await waitForNamedBackendsBlockedBy(observerPool, applicationNames, userBlockerPid)

    await userBlocker.query('COMMIT')
    userBlockerOpen = false
    if (sessionBlocker && sessionBlockerPid !== undefined) {
      await waitForNamedBackendsAfterUserRelease(
        observerPool,
        applicationNames,
        userBlockerPid,
        sessionBlockerPid,
      )
      await sessionBlocker.query('COMMIT')
      sessionBlockerOpen = false
    }

    return await withTimeout(outcomesPromise, 'PostgreSQL rotations did not settle after release')
  } finally {
    if (userBlockerOpen) await userBlocker.query('ROLLBACK')
    if (sessionBlockerOpen) await sessionBlocker?.query('ROLLBACK')
    userBlocker.release()
    sessionBlocker?.release()
    if (outcomesPromise) {
      await withTimeout(
        outcomesPromise,
        'PostgreSQL rotations did not settle during cleanup',
      ).catch(() => undefined)
    }
  }
}

function createNamedPool(connectionString: string, applicationName: string): pg.Pool {
  return new Pool({
    connectionString,
    max: 1,
    application_name: applicationName,
    statement_timeout: POSTGRES_WAIT_TIMEOUT_MS,
  })
}

describe('session queries', () => {
  it('replaces multiple revoked sessions with one fresh session', async () => {
    const userId = await createUser('replace-user')
    const otherUserId = await createUser('replace-other-user')
    const store = sessionQueries(db)
    await store.create('old-token-a', userId)
    await store.create('old-token-b', otherUserId)

    await store.replace(userId, 'fresh-token', 'old-token-a', [
      'fresh-token',
      'old-token-b',
      'old-token-a',
    ])

    expect(await store.get('old-token-a')).toBeNull()
    expect(await store.get('old-token-b')).toBeNull()
    expect(await store.get('fresh-token')).toEqual({ userId })
  })

  it('rejects a consumed source before changing optional or replacement sessions', async () => {
    const userId = await createUser('consumed-source-user')
    const store = sessionQueries(db)
    await store.create('source-token', userId)
    await store.create('optional-token', userId)
    await store.replace(userId, 'first-fresh', 'source-token', [])

    await expect(
      store.replace(userId, 'second-fresh', 'source-token', ['optional-token']),
    ).rejects.toBeInstanceOf(SessionRotationConflictError)

    expect(await store.get('first-fresh')).toEqual({ userId })
    expect(await store.get('optional-token')).toEqual({ userId })
    expect(await store.get('second-fresh')).toBeNull()
  })

  it('rejects a source owned by another user', async () => {
    const expectedUserId = await createUser('expected-source-user')
    const otherUserId = await createUser('other-source-user')
    const store = sessionQueries(db)
    await store.create('other-user-source', otherUserId)
    await store.create('optional-token', expectedUserId)

    await expect(
      store.replace(expectedUserId, 'replacement-token', 'other-user-source', ['optional-token']),
    ).rejects.toBeInstanceOf(SessionRotationConflictError)

    expect(await store.get('other-user-source')).toEqual({ userId: otherUserId })
    expect(await store.get('optional-token')).toEqual({ userId: expectedUserId })
    expect(await store.get('replacement-token')).toBeNull()
  })

  it('rolls back revocations when the replacement session insert fails', async () => {
    const userId = await createUser('rollback-user')
    const otherUserId = await createUser('rollback-conflict-user')
    const store = sessionQueries(db)
    await store.create('source-token', userId)
    await store.create('optional-token', userId)
    await store.create('conflicting-token', otherUserId)

    await expect(
      store.replace(userId, 'conflicting-token', 'source-token', ['optional-token']),
    ).rejects.toThrow()

    expect(await store.get('source-token')).toEqual({ userId })
    expect(await store.get('optional-token')).toEqual({ userId })
    expect(await store.get('conflicting-token')).toEqual({ userId: otherUserId })
  })

  it('resets only the target user sessions', async () => {
    const targetUserId = await createUser('reset-target')
    const otherUserId = await createUser('reset-other')
    const store = sessionQueries(db)
    await store.create('target-old-a', targetUserId)
    await store.create('target-old-b', targetUserId)
    await store.create('other-token', otherUserId)

    await store.resetForUser(targetUserId, 'target-fresh')

    expect(await store.get('target-old-a')).toBeNull()
    expect(await store.get('target-old-b')).toBeNull()
    expect(await store.get('target-fresh')).toEqual({ userId: targetUserId })
    expect(await store.get('other-token')).toEqual({ userId: otherUserId })
  })

  it('serializes concurrent resets to one session for the user', async () => {
    const userId = await createUser('concurrent-reset-user')
    const store = sessionQueries(db)
    await store.create('reset-old', userId)

    await Promise.all([
      store.resetForUser(userId, 'reset-fresh-a'),
      store.resetForUser(userId, 'reset-fresh-b'),
    ])

    const rows = await db
      .select({ token: sessions.token })
      .from(sessions)
      .where(eq(sessions.userId, userId))
    expect(rows).toHaveLength(1)
    expect(
      [await store.get('reset-fresh-a'), await store.get('reset-fresh-b')].filter(Boolean),
    ).toHaveLength(1)
  })

  it('atomically rotates distinct sources while revoking stale sessions across users', async () => {
    const userA = await createUser('cross-user-a')
    const userB = await createUser('cross-user-b')
    const store = sessionQueries(db)
    await store.create('source-a', userA)
    await store.create('stale-a', userA)
    await store.create('source-b', userB)
    await store.create('stale-b', userB)

    await Promise.all([
      store.replace(userA, 'fresh-a', 'source-a', ['stale-b']),
      store.replace(userB, 'fresh-b', 'source-b', ['stale-a']),
    ])

    expect(await store.get('source-a')).toBeNull()
    expect(await store.get('source-b')).toBeNull()
    expect(await store.get('stale-a')).toBeNull()
    expect(await store.get('stale-b')).toBeNull()
    expect(await store.get('fresh-a')).toEqual({ userId: userA })
    expect(await store.get('fresh-b')).toEqual({ userId: userB })
  })

  it('creates a password session only while the verified hash is current', async () => {
    const userId = await createUser('password-create')
    const store = sessionQueries(db)

    await store.createForPassword(userId, 'fresh-token', 'test-password-hash', [])
    await expect(store.get('fresh-token')).resolves.toEqual({ userId })

    await db.update(users).set({ passwordHash: 'new-hash' }).where(eq(users.id, userId))
    await expect(
      store.createForPassword(userId, 'stale-token', 'test-password-hash', []),
    ).rejects.toBeInstanceOf(PasswordCredentialConflictError)
    await expect(store.get('stale-token')).resolves.toBeNull()
  })

  it('rolls password and sessions back when replacement insertion fails', async () => {
    const userId = await createUser('password-rollback')
    const otherUserId = await createUser('password-rollback-other')
    const store = sessionQueries(db)
    await store.create('existing-session', userId)
    await store.create('conflicting-token', otherUserId)

    await expect(
      store.changePasswordAndReset(
        userId,
        'test-password-hash',
        'new-password-hash',
        'conflicting-token',
      ),
    ).rejects.toBeTruthy()

    const [row] = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId))
    expect(row?.passwordHash).toBe('test-password-hash')
    await expect(store.get('existing-session')).resolves.toEqual({ userId })
  })

  it.runIf(Boolean(POSTGRES_URL))(
    'allows exactly one concurrent rotation of a source session on PostgreSQL',
    async () => {
      if (!POSTGRES_URL) throw new Error('DATABASE_URL is required')
      const testId = randomUUID().replaceAll('-', '').slice(0, 12)
      const applicationNames = [`session-same-a-${testId}`, `session-same-b-${testId}`]
      const observerPool = new Pool({ connectionString: POSTGRES_URL, max: 3 })
      const poolA = createNamedPool(POSTGRES_URL, applicationNames[0] ?? '')
      const poolB = createNamedPool(POSTGRES_URL, applicationNames[1] ?? '')
      const observerDb = drizzle(observerPool, {
        schema: { sessions, users },
      }) as unknown as Database
      const dbA = drizzle(poolA, { schema: { sessions, users } }) as unknown as Database
      const dbB = drizzle(poolB, { schema: { sessions, users } }) as unknown as Database
      const username = `session-race-${randomUUID()}`
      let userId: number | undefined

      try {
        const [user] = await dbA
          .insert(users)
          .values({ username, passwordHash: 'test-password-hash' })
          .returning({ id: users.id })
        if (!user) throw new Error('test user was not created')
        userId = user.id
        const raceUserId = user.id

        const storeA = sessionQueries(dbA)
        const storeB = sessionQueries(dbB)
        const sourceToken = `source-${randomUUID()}`
        const optionalToken = `optional-${randomUUID()}`
        const freshA = `fresh-a-${randomUUID()}`
        const freshB = `fresh-b-${randomUUID()}`
        await storeA.create(sourceToken, raceUserId)
        await storeA.create(optionalToken, raceUserId)

        const outcomes = await runRotationsBehindUserLocks(
          observerPool,
          [raceUserId],
          applicationNames,
          [
            () => storeA.replace(raceUserId, freshA, sourceToken, [optionalToken]),
            () => storeB.replace(raceUserId, freshB, sourceToken, [optionalToken]),
          ],
        )

        expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
        const rejected = outcomes.filter((outcome) => outcome.status === 'rejected')
        expect(rejected).toHaveLength(1)
        expect(rejected[0]?.reason).toBeInstanceOf(SessionRotationConflictError)

        const rows = await dbA
          .select({ token: sessions.token })
          .from(sessions)
          .where(eq(sessions.userId, raceUserId))
        expect(rows).toHaveLength(1)
        expect([await storeA.get(freshA), await storeA.get(freshB)].filter(Boolean)).toHaveLength(1)
        expect(await storeA.get(sourceToken)).toBeNull()
        expect(await storeA.get(optionalToken)).toBeNull()
      } finally {
        try {
          if (userId !== undefined) {
            await observerDb.delete(users).where(eq(users.id, userId))
          }
        } finally {
          await Promise.all([poolA.end(), poolB.end(), observerPool.end()])
        }
      }
    },
  )

  it.runIf(Boolean(POSTGRES_URL))(
    'resolves cross-linked source revocations without a PostgreSQL deadlock',
    async () => {
      if (!POSTGRES_URL) throw new Error('DATABASE_URL is required')
      const testId = randomUUID().replaceAll('-', '').slice(0, 12)
      const applicationNames = [`session-cross-a-${testId}`, `session-cross-b-${testId}`]
      const observerPool = new Pool({ connectionString: POSTGRES_URL, max: 3 })
      const poolA = createNamedPool(POSTGRES_URL, applicationNames[0] ?? '')
      const poolB = createNamedPool(POSTGRES_URL, applicationNames[1] ?? '')
      const observerDb = drizzle(observerPool, {
        schema: { sessions, users },
      }) as unknown as Database
      const dbA = drizzle(poolA, { schema: { sessions, users } }) as unknown as Database
      const dbB = drizzle(poolB, { schema: { sessions, users } }) as unknown as Database
      const userIds: number[] = []

      try {
        const createdUsers = await observerDb
          .insert(users)
          .values([
            { username: `session-cross-a-${randomUUID()}`, passwordHash: 'test-password-hash' },
            { username: `session-cross-b-${randomUUID()}`, passwordHash: 'test-password-hash' },
          ])
          .returning({ id: users.id })
        userIds.push(...createdUsers.map((user) => user.id))
        const [userA, userB] = userIds
        if (userA === undefined || userB === undefined)
          throw new Error('test users were not created')

        const storeA = sessionQueries(dbA)
        const storeB = sessionQueries(dbB)
        const sourceA = `source-a-${randomUUID()}`
        const sourceB = `source-b-${randomUUID()}`
        const freshA = `fresh-a-${randomUUID()}`
        const freshB = `fresh-b-${randomUUID()}`
        await storeA.create(sourceA, userA)
        await storeA.create(sourceB, userB)

        const outcomes = await runRotationsBehindUserLocks(
          observerPool,
          userIds,
          applicationNames,
          [
            () => storeA.replace(userA, freshA, sourceA, [sourceB]),
            () => storeB.replace(userB, freshB, sourceB, [sourceA]),
          ],
          [sourceA, sourceB],
        )

        expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
        const rejected = outcomes.filter((outcome) => outcome.status === 'rejected')
        expect(rejected).toHaveLength(1)
        const rejectionReason = rejected[0]?.reason
        expect(rejectionReason).toBeInstanceOf(SessionRotationConflictError)
        expect(findPostgresErrorCode(rejectionReason)).not.toBe('40P01')
        expect(await storeA.get(sourceA)).toBeNull()
        expect(await storeA.get(sourceB)).toBeNull()
        expect([await storeA.get(freshA), await storeA.get(freshB)].filter(Boolean)).toHaveLength(1)
      } finally {
        try {
          if (userIds.length > 0) {
            await observerDb.delete(users).where(inArray(users.id, userIds))
          }
        } finally {
          await Promise.all([poolA.end(), poolB.end(), observerPool.end()])
        }
      }
    },
  )

  it.runIf(Boolean(POSTGRES_URL))(
    'rotates distinct sources with cross-user stale revocations on PostgreSQL',
    async () => {
      if (!POSTGRES_URL) throw new Error('DATABASE_URL is required')
      const testId = randomUUID().replaceAll('-', '').slice(0, 12)
      const applicationNames = [`session-stale-a-${testId}`, `session-stale-b-${testId}`]
      const observerPool = new Pool({ connectionString: POSTGRES_URL, max: 3 })
      const poolA = createNamedPool(POSTGRES_URL, applicationNames[0] ?? '')
      const poolB = createNamedPool(POSTGRES_URL, applicationNames[1] ?? '')
      const observerDb = drizzle(observerPool, {
        schema: { sessions, users },
      }) as unknown as Database
      const dbA = drizzle(poolA, { schema: { sessions, users } }) as unknown as Database
      const dbB = drizzle(poolB, { schema: { sessions, users } }) as unknown as Database
      const userIds: number[] = []

      try {
        const createdUsers = await observerDb
          .insert(users)
          .values([
            { username: `session-stale-a-${randomUUID()}`, passwordHash: 'test-password-hash' },
            { username: `session-stale-b-${randomUUID()}`, passwordHash: 'test-password-hash' },
          ])
          .returning({ id: users.id })
        userIds.push(...createdUsers.map((user) => user.id))
        const [userA, userB] = userIds
        if (userA === undefined || userB === undefined)
          throw new Error('test users were not created')

        const storeA = sessionQueries(dbA)
        const storeB = sessionQueries(dbB)
        const sourceA = `source-a-${randomUUID()}`
        const sourceB = `source-b-${randomUUID()}`
        const staleA = `stale-a-${randomUUID()}`
        const staleB = `stale-b-${randomUUID()}`
        const freshA = `fresh-a-${randomUUID()}`
        const freshB = `fresh-b-${randomUUID()}`
        await Promise.all([
          storeA.create(sourceA, userA),
          storeA.create(staleA, userA),
          storeB.create(sourceB, userB),
          storeB.create(staleB, userB),
        ])

        const outcomes = await runRotationsBehindUserLocks(
          observerPool,
          userIds,
          applicationNames,
          [
            () => storeA.replace(userA, freshA, sourceA, [staleB]),
            () => storeB.replace(userB, freshB, sourceB, [staleA]),
          ],
        )

        expect(outcomes).toEqual([
          { status: 'fulfilled', value: undefined },
          { status: 'fulfilled', value: undefined },
        ])
        expect(await storeA.get(sourceA)).toBeNull()
        expect(await storeA.get(sourceB)).toBeNull()
        expect(await storeA.get(staleA)).toBeNull()
        expect(await storeA.get(staleB)).toBeNull()
        expect(await storeA.get(freshA)).toEqual({ userId: userA })
        expect(await storeA.get(freshB)).toEqual({ userId: userB })
      } finally {
        try {
          if (userIds.length > 0) {
            await observerDb.delete(users).where(inArray(users.id, userIds))
          }
        } finally {
          await Promise.all([poolA.end(), poolB.end(), observerPool.end()])
        }
      }
    },
  )

  it.runIf(Boolean(POSTGRES_URL))(
    'cannot issue from a hash verified before password reset on PostgreSQL',
    async () => {
      if (!POSTGRES_URL) throw new Error('DATABASE_URL is required')
      const pool = createNamedPool(POSTGRES_URL, `session-pw-stale-${randomUUID().slice(0, 8)}`)
      const workDb = drizzle(pool, { schema: { sessions, users } }) as unknown as Database
      let userId: number | undefined

      try {
        const [user] = await workDb
          .insert(users)
          .values({
            username: `session-pw-stale-${randomUUID()}`,
            passwordHash: 'test-password-hash',
          })
          .returning({ id: users.id })
        if (!user) throw new Error('test user was not created')
        userId = user.id
        const store = sessionQueries(workDb)

        const [verified] = await workDb
          .select({ passwordHash: users.passwordHash })
          .from(users)
          .where(eq(users.id, userId))
        const verifiedHash = verified?.passwordHash
        if (verifiedHash === undefined) throw new Error('test user hash was not read')

        const resetToken = `reset-${randomUUID()}`
        await store.changePasswordAndReset(userId, verifiedHash, 'new-password-hash', resetToken)

        const staleLoginToken = `stale-login-${randomUUID()}`
        await expect(
          store.createForPassword(userId, staleLoginToken, verifiedHash, []),
        ).rejects.toBeInstanceOf(PasswordCredentialConflictError)
        expect(await store.get(staleLoginToken)).toBeNull()
        expect(await store.get(resetToken)).toEqual({ userId })
      } finally {
        if (userId !== undefined) await workDb.delete(users).where(eq(users.id, userId))
        await pool.end()
      }
    },
  )

  it.runIf(Boolean(POSTGRES_URL))(
    'leaves only the password-change session across concurrent login/reset on PostgreSQL',
    async () => {
      if (!POSTGRES_URL) throw new Error('DATABASE_URL is required')

      for (const loginFirst of [true, false]) {
        const testId = randomUUID().replaceAll('-', '').slice(0, 12)
        const loginApp = `session-pw-login-${testId}`
        const resetApp = `session-pw-reset-${testId}`
        const observerPool = new Pool({ connectionString: POSTGRES_URL, max: 3 })
        const poolLogin = createNamedPool(POSTGRES_URL, loginApp)
        const poolReset = createNamedPool(POSTGRES_URL, resetApp)
        const observerDb = drizzle(observerPool, {
          schema: { sessions, users },
        }) as unknown as Database
        const dbLogin = drizzle(poolLogin, { schema: { sessions, users } }) as unknown as Database
        const dbReset = drizzle(poolReset, { schema: { sessions, users } }) as unknown as Database
        let userId: number | undefined

        try {
          const [user] = await observerDb
            .insert(users)
            .values({
              username: `session-pw-race-${randomUUID()}`,
              passwordHash: 'test-password-hash',
            })
            .returning({ id: users.id })
          if (!user) throw new Error('test user was not created')
          userId = user.id
          const raceUserId = user.id

          const storeLogin = sessionQueries(dbLogin)
          const storeReset = sessionQueries(dbReset)
          const loginToken = `login-${randomUUID()}`
          const resetToken = `reset-${randomUUID()}`
          const loginOp = () =>
            storeLogin.createForPassword(raceUserId, loginToken, 'test-password-hash', [])
          const resetOp = () =>
            storeReset.changePasswordAndReset(
              raceUserId,
              'test-password-hash',
              'new-password-hash',
              resetToken,
            )
          const operations: [() => Promise<void>, () => Promise<void>] = loginFirst
            ? [loginOp, resetOp]
            : [resetOp, loginOp]

          const outcomes = await runRotationsBehindUserLocks(
            observerPool,
            [raceUserId],
            [loginApp, resetApp],
            operations,
          )

          const loginOutcome = outcomes[loginFirst ? 0 : 1]
          const resetOutcome = outcomes[loginFirst ? 1 : 0]
          expect(resetOutcome?.status).toBe('fulfilled')
          if (loginOutcome?.status === 'rejected') {
            expect(loginOutcome.reason).toBeInstanceOf(PasswordCredentialConflictError)
          }

          const rows = await observerDb
            .select({ token: sessions.token })
            .from(sessions)
            .where(eq(sessions.userId, raceUserId))
          expect(rows).toHaveLength(1)
          expect(rows[0]?.token).toBe(hashSessionToken(resetToken))
          expect(await storeLogin.get(loginToken)).toBeNull()

          const [row] = await observerDb
            .select({ passwordHash: users.passwordHash })
            .from(users)
            .where(eq(users.id, raceUserId))
          expect(row?.passwordHash).toBe('new-password-hash')
        } finally {
          try {
            if (userId !== undefined) {
              await observerDb.delete(users).where(eq(users.id, userId))
            }
          } finally {
            await Promise.all([poolLogin.end(), poolReset.end(), observerPool.end()])
          }
        }
      }
    },
  )
})
