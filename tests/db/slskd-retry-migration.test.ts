// @vitest-environment node
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it, vi } from 'vitest'
import { restoreBackup } from '@/core/ops/backup'
import type { OpsDb } from '@/core/ops/types'
import { slskdJobs } from '@/db/schema'
import { makeTestDb } from '../helpers/test-db'

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 })
const historySql = readFileSync('drizzle/0050_slskd_retry_history.sql', 'utf8')
const schemaSql = readFileSync('drizzle/0051_plex_accounts_slskd_retry.sql', 'utf8').replaceAll(
  '--> statement-breakpoint',
  '',
)

describe('slskd retry migration', () => {
  it('keeps all history, favors active work, and prevents duplicate failures after replay', async () => {
    const client = new PGlite()
    try {
      await client.exec(`
        CREATE TABLE users (id integer PRIMARY KEY);
        CREATE TABLE slskd_jobs (
          id integer PRIMARY KEY, work_key text NOT NULL, state text NOT NULL,
          attempts integer NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL
        );
        INSERT INTO slskd_jobs VALUES
          (1, 'active', 'queued', 2, '2026-09-16'),
          (2, 'active', 'failed', 0, '2026-09-17'),
          (3, 'retry', 'failed', 0, '2026-09-16'),
          (4, 'retry', 'failed', 3, '2026-09-17'),
          (5, 'retry', 'completed', 1, '2026-09-15');
      `)
      await client.exec(historySql)
      await client.exec(schemaSql)
      await client.exec(historySql)
      await client.exec(schemaSql)
      const result = await client.query('SELECT id, state, attempts FROM slskd_jobs ORDER BY id')
      expect(result.rows).toEqual([
        { id: 1, state: 'queued', attempts: 3 },
        { id: 2, state: 'superseded', attempts: 0 },
        { id: 3, state: 'superseded', attempts: 0 },
        { id: 4, state: 'failed', attempts: 4 },
        { id: 5, state: 'completed', attempts: 1 },
      ])
      await expect(
        client.exec("INSERT INTO slskd_jobs VALUES (6, 'retry', 'failed', 0, now())"),
      ).rejects.toThrow(/unique/)
    } finally {
      await client.close()
    }
  })
  it('restores a pre-migration backup with duplicate failures into the migrated database', async () => {
    const { db, close } = await makeTestDb()
    const job = {
      targetId: 1,
      sourceType: 'approval',
      workKey: 'album',
      artistMbid: '00000000-0000-0000-0000-000000000001',
      artistName: 'Artist',
      releaseTitle: 'Album',
      state: 'failed',
      attempts: 0,
      createdAt: '2026-09-16T00:00:00Z',
      updatedAt: '2026-09-16T00:00:00Z',
    }
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
            users: [],
            oauthTokens: [],
            subscriptions: [],
            jobRuns: [],
            recommendationBatches: [],
            recommendations: [],
            playlists: [],
            playlistTracks: [],
            artistBlocks: [],
            targets: [{ id: 1, type: 'slskd', name: 'Downloads', config: {} }],
            slskdJobs: [
              { ...job, id: 1 },
              { ...job, id: 2, updatedAt: '2026-09-17T00:00:00Z' },
            ],
          },
        },
        { force: true },
      )
      expect(result.tablesRestored.slskdJobs).toBe(2)
      const rows = await db.select().from(slskdJobs).orderBy(slskdJobs.id)
      expect(rows.map(({ id, state, attempts }) => ({ id, state, attempts }))).toEqual([
        { id: 1, state: 'superseded', attempts: 0 },
        { id: 2, state: 'failed', attempts: 2 },
      ])
    } finally {
      await close()
    }
  })
})
