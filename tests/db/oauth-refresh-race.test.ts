// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { getValidToken } from '@/core/oauth'
import type { Database } from '@/db'
import { deleteOAuthToken, getOAuthToken, upsertOAuthToken } from '@/db/queries/oauth-tokens'
import { createUser } from '@/db/queries/users'
import { makeTestDb } from '../helpers/test-db'

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 })

let db: Database
let close: () => Promise<void>

beforeAll(async () => {
  const result = await makeTestDb()
  db = result.db as unknown as Database
  close = result.close
})

afterAll(async () => {
  await close?.()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const config = { tokenEndpoint: 'https://provider.test/token', clientId: 'id', clientSecret: 'old' }

async function seedExpired(username: string) {
  const user = await createUser(db, { username, passwordHash: 'test-hash' })
  await upsertOAuthToken(db, {
    userId: user.id,
    provider: 'spotify',
    accessToken: 'expired',
    refreshToken: 'old-refresh',
    expiresAt: new Date(Date.now() - 60_000),
    clientId: 'id',
    clientSecret: 'old',
  })
  return user.id
}

/** Suspend the token endpoint until the returned release() is called. */
function suspendRefresh() {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let entered!: () => void
  const reached = new Promise<void>((resolve) => {
    entered = resolve
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      entered()
      await gate
      return Response.json({ access_token: 'refreshed', expires_in: 3600, token_type: 'Bearer' })
    }),
  )
  return { reached, release }
}

describe('OAuth refresh races', () => {
  it('does not resurrect a connection deleted during refresh', async () => {
    const userId = await seedExpired('race-delete')
    const { reached, release } = suspendRefresh()

    const pending = getValidToken(db, userId, 'spotify', config)
    await reached
    await deleteOAuthToken(db, userId, 'spotify')
    release()

    await expect(pending).resolves.toBeNull()
    await expect(getOAuthToken(db, userId, 'spotify')).resolves.toBeNull()
  })

  it('keeps credentials saved by a reconnect during refresh', async () => {
    const userId = await seedExpired('race-reconnect')
    const { reached, release } = suspendRefresh()

    const pending = getValidToken(db, userId, 'spotify', config)
    await reached
    await upsertOAuthToken(db, {
      userId,
      provider: 'spotify',
      accessToken: 'reconnected',
      refreshToken: 'new-refresh',
      expiresAt: new Date(Date.now() + 3_600_000),
      clientId: 'id',
      clientSecret: 'new',
    })
    release()

    await expect(pending).resolves.toBe('reconnected')
    const row = await getOAuthToken(db, userId, 'spotify')
    expect(row).toMatchObject({
      accessToken: 'reconnected',
      refreshToken: 'new-refresh',
      clientSecret: 'new',
    })
  })

  it('stores the refresh when nothing changed in between', async () => {
    const userId = await seedExpired('race-none')
    const { reached, release } = suspendRefresh()

    const pending = getValidToken(db, userId, 'spotify', config)
    await reached
    release()

    await expect(pending).resolves.toBe('refreshed')
    await expect(getOAuthToken(db, userId, 'spotify')).resolves.toMatchObject({
      accessToken: 'refreshed',
      refreshToken: 'old-refresh',
    })
  })
})
