// @vitest-environment node
import { readFileSync } from 'node:fs'
import { asc, sql } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { restoreBackup } from '@/core/ops/backup'
import type { OpsDb } from '@/core/ops/types'
import type { Database } from '@/db'
import { filterOwnedIds } from '@/db/queries/recommendations'
import { artists, recommendationBatches, recommendations, users } from '@/db/schema'
import { makeTestDb } from '../helpers/test-db'

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 })
const backfillSql = readFileSync('drizzle/0055_recommendations_owner_backfill.sql', 'utf8')

describe('recommendation owner backfill migration', () => {
  it('assigns ownerless recommendations to the first admin and is safe to re-run', async () => {
    const { db, close } = await makeTestDb()
    try {
      const [member, admin, laterAdmin] = await db
        .insert(users)
        .values([
          { username: 'member', passwordHash: 'x' },
          { username: 'admin', passwordHash: 'x', isAdmin: true },
          { username: 'later-admin', passwordHash: 'x', isAdmin: true },
        ])
        .returning()
      const [batch] = await db.insert(recommendationBatches).values({}).returning()
      const [artist] = await db
        .insert(artists)
        .values({ mbid: '00000000-0000-0000-0000-000000000301', name: 'Legacy' })
        .returning()
      if (!member || !admin || !laterAdmin || !batch || !artist) throw new Error('fixture missing')
      const [legacy, owned] = await db
        .insert(recommendations)
        .values([
          { userId: null, artistId: artist.id, batchId: batch.id, score: 0.5 },
          { userId: member.id, artistId: artist.id, batchId: batch.id, score: 0.5 },
        ])
        .returning()
      if (!legacy || !owned) throw new Error('fixture missing')
      const ids = [legacy.id, owned.id]
      await expect(filterOwnedIds(db as unknown as Database, ids, member.id)).resolves.toEqual([
        owned.id,
      ])

      await db.execute(sql.raw(backfillSql))
      await db.execute(sql.raw(backfillSql))

      const rows = await db
        .select({ userId: recommendations.userId })
        .from(recommendations)
        .orderBy(asc(recommendations.id))
      expect(rows).toEqual([{ userId: admin.id }, { userId: member.id }])
    } finally {
      await close()
    }
  })

  it('assigns ownerless recommendations from a restored older backup', async () => {
    const { db, close } = await makeTestDb()
    try {
      const result = await restoreBackup(
        db as unknown as OpsDb,
        {
          version: 1,
          appVersion: '1.17.0',
          createdAt: '2026-09-16T00:00:00Z',
          encryptionKeyHash: null,
          includesCaches: false,
          data: {
            settings: [],
            users: [
              { id: 1, username: 'member', passwordHash: 'x', isAdmin: false },
              { id: 2, username: 'admin', passwordHash: 'x', isAdmin: true },
            ],
            oauthTokens: [],
            subscriptions: [],
            jobRuns: [],
            artists: [{ id: 1, mbid: '00000000-0000-0000-0000-000000000302', name: 'Legacy' }],
            recommendationBatches: [{ id: 1 }],
            recommendations: [{ id: 1, userId: null, artistId: 1, batchId: 1, score: 0.5 }],
            playlists: [],
            playlistTracks: [],
            artistBlocks: [],
          },
        } as never,
        { force: true },
      )

      expect(result.tablesRestored.recommendations).toBe(1)
      const rows = await db.select({ userId: recommendations.userId }).from(recommendations)
      expect(rows).toEqual([{ userId: 2 }])
    } finally {
      await close()
    }
  })
})
