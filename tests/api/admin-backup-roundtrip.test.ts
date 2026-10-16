// @vitest-environment node

import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackupFile } from '@/core/ops/types'
import { runPreFlightCheck } from '@/core/ops/upgrade'
import { clearAllSessions, createSession } from '@/core/sessions'
import * as schema from '@/db/schema'
import { createTestApp } from '../helpers/test-app'
import { makeTestDb } from '../helpers/test-db'

const SESSION_TOKEN = 'admin-backup-roundtrip-session'

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

beforeEach(async () => {
  await clearAllSessions()
  await createSession(1, SESSION_TOKEN)
})

afterEach(async () => {
  await clearAllSessions()
})

describe('admin recovery backup round trip', () => {
  it.each([false, true])(
    'restores state into a fresh database (includeCaches=%s)',
    async (includeCaches) => {
      const { db, close } = await makeTestDb()
      const target = await makeTestDb()
      try {
        const mbid = '00000000-0000-0000-0000-000000000051'
        await db.insert(schema.users).values({ id: 1, username: 'recover', passwordHash: 'hash' })
        await db.insert(schema.artists).values({
          id: 1,
          mbid,
          name: 'Round Trip',
          genres: ['ambient'],
          genresCachedAt: new Date(),
        })
        await db.insert(schema.artistGenreAliases).values({
          source: 'subsonic',
          nameNormalized: 'round trip',
          mbid,
        })
        await db.insert(schema.recommendationBatches).values({ id: 1 })
        await db.insert(schema.recommendations).values({
          id: 1,
          userId: 1,
          artistId: 1,
          batchId: 1,
          score: 0.8,
          status: 'approved',
        })
        await db.insert(schema.artistBlocks).values({ userId: 1, artistId: 1, reason: 'other' })
        await db
          .insert(schema.albumBlocks)
          .values({ userId: 1, artistId: 1, releaseGroupMbid: mbid })
        await db.insert(schema.libraryMatchOverrides).values({
          userId: 1,
          source: 'plex',
          sourceArtistId: 'artist-1',
          correctMbid: mbid,
        })
        await db.insert(schema.libraryAlbumMatchOverrides).values({
          userId: 1,
          source: 'plex',
          sourceAlbumId: 'album-1',
          correctAlbumMbid: mbid,
        })
        await db
          .insert(schema.playlists)
          .values({ id: 1, userId: 1, name: 'Recovery', strategy: 'audition' })
        await db
          .insert(schema.playlistTracks)
          .values({ playlistId: 1, artistName: 'Round Trip', position: 1 })
        await db
          .insert(schema.targets)
          .values({ id: 1, userId: 1, type: 'slskd', name: 'Recovery target' })
        await db.insert(schema.playlistExports).values({
          playlistId: 1,
          targetId: 1,
          remoteScope: 'v1:roundtrip-scope',
          remotePlaylistId: 'roundtrip-remote',
          state: 'linked',
        })
        await db.insert(schema.slskdJobs).values({
          userId: 1,
          targetId: 1,
          recommendationId: 1,
          sourceType: 'recommendation',
          workKey: 'recover-1',
          artistMbid: mbid,
          artistName: 'Round Trip',
          releaseTitle: 'Release',
          state: 'failed',
          attempts: 3,
        })
        const { app } = createTestApp({ db: db as never })

        const backupResponse = await app.request(
          `/api/v1/admin/backup${includeCaches ? '?includeCaches=true' : ''}`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${SESSION_TOKEN}` },
          },
        )
        expect(backupResponse.status).toBe(200)
        const backup = (await backupResponse.json()) as BackupFile
        expect(backup.includesCaches).toBe(includeCaches)
        if (includeCaches) expect(backup.data.artistMetadata).toEqual([])
        else expect(backup.data).not.toHaveProperty('artistMetadata')
        expect(backup.data.artistGenreAliases).toHaveLength(1)
        expect(backup.data.playlistExports).toHaveLength(1)

        const { app: targetApp } = createTestApp({ db: target.db as never })
        const restoreResponse = await targetApp.request(
          '/api/v1/admin/restore?confirm=true&force=true',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${SESSION_TOKEN}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(backup),
          },
        )

        expect(restoreResponse.status).toBe(200)
        expect(await target.db.select().from(schema.artistGenreAliases)).toHaveLength(1)
        expect(await target.db.select().from(schema.artistBlocks)).toHaveLength(1)
        expect(await target.db.select().from(schema.albumBlocks)).toHaveLength(1)
        expect(await target.db.select().from(schema.libraryMatchOverrides)).toHaveLength(1)
        expect(await target.db.select().from(schema.libraryAlbumMatchOverrides)).toHaveLength(1)
        expect(await target.db.select().from(schema.playlistTracks)).toHaveLength(1)
        expect(await target.db.select().from(schema.playlistExports)).toMatchObject([
          { playlistId: 1, targetId: 1, remotePlaylistId: 'roundtrip-remote', state: 'linked' },
        ])
        expect(await target.db.select().from(schema.recommendations)).toMatchObject([
          { status: 'approved' },
        ])
        expect(await target.db.select().from(schema.slskdJobs)).toMatchObject([
          { attempts: 3, state: 'failed' },
        ])
      } finally {
        await close()
        await target.close()
      }
    },
  )

  it('returns 422 for an unsafe partial restore even with force=true and preserves existing data', async () => {
    const { db, close } = await makeTestDb()
    try {
      await db.insert(schema.users).values({ id: 1, username: 'retained', passwordHash: 'hash' })
      await db.insert(schema.libraryMatchOverrides).values({
        userId: 1,
        source: 'plex',
        sourceArtistId: 'retained',
        note: 'keep this decision',
      })
      const { app } = createTestApp({ db: db as never })
      const backupResponse = await app.request('/api/v1/admin/backup', {
        method: 'POST',
        headers: { Authorization: `Bearer ${SESSION_TOKEN}` },
      })
      const backup = (await backupResponse.json()) as BackupFile
      delete backup.data.libraryMatchOverrides
      backup.data.users[0] = { ...backup.data.users[0], username: 'must-not-restore' }
      const before = await db.select().from(schema.libraryMatchOverrides)

      const response = await app.request('/api/v1/admin/restore?confirm=true&force=true', {
        method: 'POST',
        headers: { Authorization: `Bearer ${SESSION_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(backup),
      })

      expect(response.status).toBe(422)
      expect(await response.json()).toMatchObject({
        code: 'partial_backup_conflict',
        affectedTables: expect.arrayContaining(['libraryMatchOverrides']),
      })
      expect(await db.select().from(schema.libraryMatchOverrides)).toEqual(before)
      expect(await db.select().from(schema.users)).toMatchObject([{ username: 'retained' }])
    } finally {
      await close()
    }
  })

  it('snapshots an older schema without the columns it lacks', async () => {
    const { db, close } = await makeTestDb()
    const backupDir = mkdtempSync(join(tmpdir(), 'digarr-upgrade-backup-'))
    vi.stubEnv('DIGARR_AUTO_BACKUP', 'true')
    vi.stubEnv('DIGARR_BACKUP_DIR', backupDir)
    try {
      await db.insert(schema.settings).values({ id: 1 })
      await db.execute(sql`alter table settings drop column digest_last_sent_at`)
      await db.execute(
        sql`delete from drizzle.__drizzle_migrations where id = (select max(id) from drizzle.__drizzle_migrations)`,
      )

      const result = await runPreFlightCheck(db as never)
      expect(readdirSync(backupDir)).toHaveLength(1)
      const snapshot = JSON.parse(readFileSync(result.backupPath as string, 'utf-8'))
      expect(snapshot.absentSchema.columns).toEqual({ settings: ['digest_last_sent_at'] })
      expect(snapshot.data.settings).toHaveLength(1)
      const rows = await db.execute(sql`select count(*)::int as count from settings`)
      expect(rows.rows).toEqual([{ count: 1 }])
    } finally {
      vi.unstubAllEnvs()
      rmSync(backupDir, { recursive: true, force: true })
      await close()
    }
  })
})
