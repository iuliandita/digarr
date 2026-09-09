// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '@/db'
import {
  createUser,
  deleteUser,
  FirstUserRequiredError,
  LastAdminError,
  updateUser,
} from '@/db/queries/users'
import { artists, recommendationBatches, recommendations, subscriptions, users } from '@/db/schema'
import { makeTestDb } from '../helpers/test-db'

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 })
let close: (() => Promise<void>) | undefined
afterEach(async () => {
  await close?.()
  close = undefined
})

async function database() {
  const result = await makeTestDb()
  close = result.close
  return result.db as unknown as Database
}

const credentials = (username: string) => ({ username, passwordHash: 'test-hash' })

describe('user management on migrated PGlite', () => {
  it.each(['demote', 'delete', 'mixed'] as const)(
    'preserves an admin during concurrent %s operations',
    async (operation) => {
      const db = await database()
      const first = await createUser(db, { ...credentials('first'), isAdmin: true })
      const second = await createUser(db, { ...credentials('second'), isAdmin: true })
      const results = await Promise.allSettled(
        [first, second].map((user, index) =>
          operation === 'delete' || (operation === 'mixed' && index === 0)
            ? deleteUser(db, user.id)
            : updateUser(db, user.id, { isAdmin: false }),
        ),
      )
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      const failures = results.filter((result) => result.status === 'rejected')
      expect(failures).toHaveLength(1)
      expect(failures[0]?.reason).toBeInstanceOf(LastAdminError)
      expect((await db.select().from(users)).filter((user) => user.isAdmin)).toHaveLength(1)
    },
  )

  it('allows intentional admin creation and promotion after bootstrap', async () => {
    const db = await database()
    await createUser(db, credentials('first'), { bootstrap: 'allow-existing' })
    const promoted = await createUser(db, credentials('promoted'))
    await updateUser(db, promoted.id, { isAdmin: true })
    await createUser(db, { ...credentials('created-admin'), isAdmin: true })
    expect((await db.select().from(users)).filter((user) => user.isAdmin)).toHaveLength(3)
  })

  it('serializes concurrent bootstrap attempts and chooses one admin', async () => {
    const db = await database()
    const created = await Promise.all(
      ['first', 'second'].map((name) =>
        createUser(db, credentials(name), { bootstrap: 'allow-existing' }),
      ),
    )
    expect(created.filter((user) => user.isAdmin)).toHaveLength(1)
    expect(await db.select().from(users)).toHaveLength(2)
  })

  it('refuses the closed-registration or env bootstrap loser', async () => {
    const db = await database()
    const results = await Promise.allSettled(
      ['first', 'second'].map((name) =>
        createUser(db, credentials(name), { bootstrap: 'first-user-only' }),
      ),
    )
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((result) => result.status === 'rejected')
    expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(
      FirstUserRequiredError,
    )
    expect(await db.select().from(users)).toHaveLength(1)
  })

  it('deletes owned data while retaining shared artists, batches, and another user data', async () => {
    const db = await database()
    const owner = await createUser(db, credentials('owner'))
    const other = await createUser(db, credentials('other'))
    const [artist] = await db
      .insert(artists)
      .values({ name: 'Shared artist', mbid: '11111111-1111-4111-8111-111111111111' })
      .returning()
    if (!artist) throw new Error('Artist insert returned no row')
    const [subscription] = await db
      .insert(subscriptions)
      .values({
        name: 'Owned subscription',
        userId: owner.id,
        sourceType: 'tag',
        sourceProvider: 'lastfm',
        sourceConfig: {},
        cron: '0 0 * * *',
      })
      .returning()
    if (!subscription) throw new Error('Subscription insert returned no row')
    const [batch] = await db
      .insert(recommendationBatches)
      .values({ subscriptionId: subscription.id })
      .returning()
    if (!batch) throw new Error('Batch insert returned no row')
    await db.insert(recommendations).values(
      [owner.id, other.id, null].map((userId) => ({
        userId,
        artistId: artist.id,
        batchId: batch.id,
        score: 0.8,
      })),
    )
    await deleteUser(db, owner.id)
    expect(await db.select().from(subscriptions)).toEqual([])
    expect((await db.select().from(recommendations)).map((row) => row.userId)).toEqual([
      other.id,
      null,
    ])
    expect(await db.select().from(artists)).toHaveLength(1)
    expect(await db.select().from(recommendationBatches)).toEqual([
      expect.objectContaining({ id: batch.id, subscriptionId: null }),
    ])
    expect(await db.select().from(users)).toEqual([expect.objectContaining({ id: other.id })])
  })
})
