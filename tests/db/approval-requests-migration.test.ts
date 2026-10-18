// @vitest-environment node
import { readFileSync } from 'node:fs'
import { eq, sql } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { createBackup, restoreBackup } from '@/core/ops/backup'
import type { OpsDb } from '@/core/ops/types'
import type { Database } from '@/db'
import { createUser, updateUser } from '@/db/queries/users'
import * as schema from '@/db/schema'
import { makeTestDb } from '../helpers/test-db'

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 })

async function fixture() {
  const h = await makeTestDb()
  const [user] = await h.db
    .insert(schema.users)
    .values({
      username: 'requester',
      passwordHash: 'x',
      approvalPolicy: 'request_only',
      maxOpenRequests: 2,
    })
    .returning()
  const [admin] = await h.db
    .insert(schema.users)
    .values({ username: 'admin', passwordHash: 'x', isAdmin: true })
    .returning()
  const [artist] = await h.db
    .insert(schema.artists)
    .values({ mbid: '12345678-1234-1234-1234-123456789abc', name: 'Artist' })
    .returning()
  const [batch] = await h.db.insert(schema.recommendationBatches).values({}).returning()
  if (!user || !admin || !artist || !batch) throw new Error('Missing fixture')
  const [rec] = await h.db
    .insert(schema.recommendations)
    .values({ userId: user.id, artistId: artist.id, batchId: batch.id, score: 0.9 })
    .returning()
  if (!rec) throw new Error('Missing recommendation')
  return { ...h, user, admin, rec }
}

describe('approval request persistence', () => {
  it('re-runs safely, constrains pending duplicates, and retains resolved history', async () => {
    const { db, close, user, rec } = await fixture()
    try {
      const migration = readFileSync('drizzle/0059_certain_centennial.sql', 'utf8')
      for (const statement of migration.split('--> statement-breakpoint'))
        await db.execute(sql.raw(statement))
      const [request] = await db
        .insert(schema.approvalRequests)
        .values({ userId: user.id, recommendationId: rec.id, options: { monitorOption: 'all' } })
        .returning()
      expect(request?.status).toBe('pending')
      await expect(
        db
          .insert(schema.approvalRequests)
          .values({ userId: user.id, recommendationId: rec.id, options: {} }),
      ).rejects.toThrow()
      await db
        .update(schema.approvalRequests)
        .set({ status: 'declined' })
        .where(eq(schema.approvalRequests.id, request?.id ?? 0))
      await db
        .insert(schema.approvalRequests)
        .values({ userId: user.id, recommendationId: rec.id, options: {} })
      await expect(
        db.update(schema.users).set({ maxOpenRequests: -1 }).where(eq(schema.users.id, user.id)),
      ).rejects.toThrow()
      await expect(
        db.update(schema.users).set({ approvalThreshold: 1.1 }).where(eq(schema.users.id, user.id)),
      ).rejects.toThrow()
    } finally {
      await close()
    }
  })

  it('round-trips decisions and policy with natural-key remapping and accepts older backups', async () => {
    const { db, close, user, admin, rec } = await fixture()
    try {
      await db.insert(schema.approvalRequests).values({
        userId: user.id,
        recommendationId: rec.id,
        status: 'approved',
        options: { selectedAlbumIds: ['release'] },
        note: 'Selected albums',
        decidedBy: admin.id,
        decidedAt: new Date(),
      })
      const backup = await createBackup(db as unknown as OpsDb)
      const request = backup.data.approvalRequests?.[0]
      if (!request) throw new Error('Missing backup request')
      expect(request.requesterUsername).toBe('requester')
      expect(request.deciderUsername).toBe('admin')
      request.userId = 99999
      request.decidedBy = 99999
      request.recommendationId = 99999
      const result = await restoreBackup(
        db as unknown as OpsDb,
        JSON.parse(JSON.stringify(backup)),
        { force: true },
      )
      expect(result.tablesRestored.approvalRequests).toBe(1)
      const [restored] = await db.select().from(schema.approvalRequests)
      expect(restored).toMatchObject({
        token: request.token,
        userId: user.id,
        decidedBy: admin.id,
        recommendationId: rec.id,
        status: 'approved',
        note: 'Selected albums',
        options: { selectedAlbumIds: ['release'] },
      })
      expect(restored?.decidedAt).toBeInstanceOf(Date)
      await db.delete(schema.approvalRequests)
      delete backup.data.approvalRequests
      for (const row of backup.data.users) {
        delete row.approvalPolicy
        delete row.maxOpenRequests
        delete row.approvalThreshold
      }
      await restoreBackup(db as unknown as OpsDb, backup, { force: true })
      const [legacyUser] = await db.select().from(schema.users).where(eq(schema.users.id, user.id))
      expect(legacyUser).toMatchObject({
        approvalPolicy: 'direct',
        maxOpenRequests: null,
        approvalThreshold: null,
      })
    } finally {
      await close()
    }
  })

  it('locks a default threshold when an administrator enables trusted approval', async () => {
    const { db, close } = await makeTestDb()
    try {
      const user = await createUser(db as unknown as Database, {
        username: 'trusted',
        passwordHash: 'x',
        approvalPolicy: 'auto_approve',
      })
      expect(user.approvalThreshold).toBeCloseTo(0.8)
      await updateUser(db as unknown as Database, user.id, {
        approvalPolicy: 'request_only',
        approvalThreshold: 0.6,
        maxOpenRequests: 0,
      })
      const [updated] = await db.select().from(schema.users).where(eq(schema.users.id, user.id))
      expect(updated).toMatchObject({ approvalPolicy: 'request_only', maxOpenRequests: 0 })
      expect(updated?.approvalThreshold).toBeCloseTo(0.6)
    } finally {
      await close()
    }
  })
})
