// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest'
import * as auth from '@/core/auth'
import { bootstrapInitialAdmin } from '@/core/ops/initial-admin'
import type { Database } from '@/db'
import * as userQueries from '@/db/queries/users'
import { users } from '@/db/schema'
import { makeTestDb } from '../../helpers/test-db'

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 })
let close: (() => Promise<void>) | undefined
afterEach(async () => {
  vi.restoreAllMocks()
  await close?.()
  close = undefined
})

async function database() {
  const result = await makeTestDb()
  close = result.close
  return result.db as unknown as Database
}

const config = { initialUsername: 'intended', initialPassword: 'a secure password' }

describe('initial admin bootstrap', () => {
  it('creates the first administrator and preserves the exact credential bytes', async () => {
    const db = await database()
    const credentials = { initialUsername: ' admin ', initialPassword: ' password with spaces ' }
    await bootstrapInitialAdmin(db, credentials)

    const created = await db.select().from(users)
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({ username: credentials.initialUsername, isAdmin: true })
    const passwordHash = created[0]?.passwordHash ?? ''
    expect(passwordHash).not.toBe(credentials.initialPassword)
    expect(auth.verifyPassword(credentials.initialPassword, passwordHash)).toBe(true)
    expect(auth.verifyPassword(credentials.initialPassword.trim(), passwordHash)).toBe(false)
  })

  it.each([
    { initialUsername: 'existing', initialPassword: 'weak' },
    { initialPassword: 'weak' },
    config,
  ])('leaves existing accounts unchanged with stale config %j', async (staleConfig) => {
    const db = await database()
    await userQueries.createUser(db, { username: 'existing', passwordHash: 'unchanged-hash' })
    const before = await db.select().from(users)

    await bootstrapInitialAdmin(db, staleConfig)

    expect(await db.select().from(users)).toEqual(before)
  })

  it('keeps an unconfigured empty database available for manual registration', async () => {
    const db = await database()
    await bootstrapInitialAdmin(db, {})
    expect(await db.select().from(users)).toEqual([])
  })

  it.each([
    { initialUsername: 'intended' },
    { initialPassword: config.initialPassword },
    { initialUsername: 'intended', initialPassword: 'short' },
  ])('rejects incomplete or weak first-boot config %j without creating a user', async (invalid) => {
    const db = await database()
    await expect(bootstrapInitialAdmin(db, invalid)).rejects.toThrow(/DIGARR_INITIAL_/)
    expect(await db.select().from(users)).toEqual([])
  })

  it.each(['count', 'hash', 'insert', 'competing user', 'wrong username', 'not admin'])(
    'fails closed when bootstrap encounters %s',
    async (failure) => {
      const count = vi.spyOn(userQueries, 'getUserCount').mockResolvedValue(0)
      const hash = vi.spyOn(auth, 'hashPassword').mockReturnValue('test-hash')
      const insert = vi.spyOn(userQueries, 'createUser').mockResolvedValue({
        username: config.initialUsername,
        isAdmin: true,
      } as Awaited<ReturnType<typeof userQueries.createUser>>)
      const error = new Error('operation failed')
      if (failure === 'count') count.mockRejectedValue(error)
      if (failure === 'hash')
        hash.mockImplementation(() => {
          throw error
        })
      if (failure === 'insert') insert.mockRejectedValue(error)
      if (failure === 'competing user') {
        insert.mockRejectedValue(new userQueries.FirstUserRequiredError())
      }
      if (failure === 'wrong username') {
        insert.mockResolvedValue({ username: 'other', isAdmin: true } as Awaited<
          ReturnType<typeof userQueries.createUser>
        >)
      }
      if (failure === 'not admin') {
        insert.mockResolvedValue({ username: config.initialUsername, isAdmin: false } as Awaited<
          ReturnType<typeof userQueries.createUser>
        >)
      }

      await expect(bootstrapInitialAdmin({} as Database, config)).rejects.toThrow()
    },
  )
})
