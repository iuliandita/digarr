// @vitest-environment node
import { readFileSync } from 'node:fs'
import { asc, sql } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { restoreBackup } from '@/core/ops/backup'
import type { OpsDb } from '@/core/ops/types'
import type { Database } from '@/db'
import { getScheduledPlaylists } from '@/db/queries/playlists'
import { playlists } from '@/db/schema'
import { makeTestDb } from '../helpers/test-db'

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 })
const retireSql = readFileSync('drizzle/0057_playlist_enabled_retire.sql', 'utf8')

describe('playlist enabled retirement migration', () => {
  it('clears schedules on disabled playlists, leaves other rows alone, and is safe to re-run', async () => {
    const { db, close } = await makeTestDb()
    try {
      await db.insert(playlists).values([
        { name: 'Disabled weekly', strategy: 'audition', schedule: '0 8 * * 1', enabled: false },
        { name: 'Disabled manual', strategy: 'audition', schedule: null, enabled: false },
        { name: 'Weekly', strategy: 'audition', schedule: '0 8 * * 1', enabled: true },
      ])

      await db.execute(sql.raw(retireSql))
      await db.execute(sql.raw(retireSql))

      const rows = await db
        .select({ name: playlists.name, schedule: playlists.schedule, enabled: playlists.enabled })
        .from(playlists)
        .orderBy(asc(playlists.id))
      expect(rows).toEqual([
        { name: 'Disabled weekly', schedule: null, enabled: true },
        { name: 'Disabled manual', schedule: null, enabled: false },
        { name: 'Weekly', schedule: '0 8 * * 1', enabled: true },
      ])

      const scheduled = await getScheduledPlaylists(db as unknown as Database)
      expect(scheduled.map((playlist) => playlist.name)).toEqual(['Weekly'])
    } finally {
      await close()
    }
  })

  it('applies the same rule to a disabled scheduled playlist restored from an older backup', async () => {
    const { db, close } = await makeTestDb()
    try {
      await restoreBackup(
        db as unknown as OpsDb,
        {
          version: 1,
          appVersion: '2.0.1',
          createdAt: '2026-10-01T00:00:00Z',
          encryptionKeyHash: null,
          includesCaches: false,
          data: {
            settings: [],
            users: [],
            oauthTokens: [],
            subscriptions: [],
            jobRuns: [],
            artists: [],
            recommendationBatches: [],
            recommendations: [],
            playlists: [
              {
                id: 1,
                userId: null,
                name: 'Restored disabled weekly',
                strategy: 'audition',
                targetIds: [],
                schedule: '0 8 * * 1',
                config: null,
                lastGeneratedAt: null,
                trackCount: 0,
                enabled: false,
                createdAt: '2026-10-01T00:00:00.000Z',
              },
            ],
            playlistTracks: [],
            artistBlocks: [],
          },
        } as never,
        { force: true },
      )

      const rows = await db
        .select({ schedule: playlists.schedule, enabled: playlists.enabled })
        .from(playlists)
      expect(rows).toEqual([{ schedule: null, enabled: true }])
    } finally {
      await close()
    }
  })
})
