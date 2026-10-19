// @vitest-environment node
import { readFileSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { createBackup, restoreBackup } from '@/core/ops/backup'
import type { OpsDb } from '@/core/ops/types'
import { buildStrategyDeps } from '@/core/playlists/strategy-deps'
import type { Database } from '@/db'
import { artists, recommendationBatches, recommendations, users } from '@/db/schema'
import { makeTestDb } from '../helpers/test-db'

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 })
const migrationSql = readFileSync('drizzle/0062_recommended_recording.sql', 'utf8')
const RECORDING = 'e8f9b188-f819-4e43-ab0f-4bd26ce9ff56'

async function seed(db: Awaited<ReturnType<typeof makeTestDb>>['db']) {
  const [user] = await db
    .insert(users)
    .values({ username: 'admin', passwordHash: 'x', isAdmin: true })
    .returning()
  const [batch] = await db.insert(recommendationBatches).values({}).returning()
  const [artist] = await db
    .insert(artists)
    .values({ mbid: '8f6bd1e4-fbe1-4f50-aa9b-94c450ec0f11', name: 'Portishead' })
    .returning()
  if (!user || !batch || !artist) throw new Error('fixture missing')
  await db.insert(recommendations).values([
    { userId: user.id, artistId: artist.id, batchId: batch.id, score: 0.4 },
    {
      userId: user.id,
      artistId: artist.id,
      batchId: batch.id,
      score: 0.9,
      recommendedRecordingMbid: RECORDING,
      recommendedRecordingTitle: 'Roads',
    },
  ])
  return user
}

function recordingRows(db: Awaited<ReturnType<typeof makeTestDb>>['db']) {
  return db
    .select({
      mbid: recommendations.recommendedRecordingMbid,
      title: recommendations.recommendedRecordingTitle,
    })
    .from(recommendations)
    .orderBy(recommendations.score)
}

describe('recommended recording storage on PGlite', () => {
  it('re-runs the migration safely and feeds Audition the stored recording', async () => {
    const { db, close } = await makeTestDb()
    try {
      for (const statement of migrationSql.split('--> statement-breakpoint')) {
        await db.execute(sql.raw(statement))
      }
      const user = await seed(db)

      const pending = await buildStrategyDeps(db as unknown as Database, user.id).getPendingArtists(
        {
          limit: 10,
        },
      )

      expect(pending).toEqual([
        expect.objectContaining({
          name: 'Portishead',
          recording: { mbid: RECORDING, title: 'Roads' },
        }),
      ])
    } finally {
      await close()
    }
  })

  it('round-trips the recording and restores older backups without it', async () => {
    const source = await makeTestDb()
    const target = await makeTestDb()
    try {
      await seed(source.db)
      const backup = await createBackup(source.db as unknown as OpsDb)

      await restoreBackup(target.db as unknown as OpsDb, backup, { force: true })
      expect(await recordingRows(target.db)).toEqual([
        { mbid: null, title: null },
        { mbid: RECORDING, title: 'Roads' },
      ])

      const legacy = structuredClone(backup)
      for (const row of legacy.data.recommendations ?? []) {
        delete (row as Record<string, unknown>).recommendedRecordingMbid
        delete (row as Record<string, unknown>).recommendedRecordingTitle
      }
      await restoreBackup(target.db as unknown as OpsDb, legacy, { force: true })
      expect(await recordingRows(target.db)).toEqual([
        { mbid: null, title: null },
        { mbid: null, title: null },
      ])
    } finally {
      await source.close()
      await target.close()
    }
  })
})
