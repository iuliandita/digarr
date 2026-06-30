import { describe, expect, it } from 'vitest'
import { createBackup, restoreBackup } from '@/core/ops/backup'
import * as schema from '@/db/schema'
import { makeTestDb } from '../helpers/test-db'

describe('backup full-fidelity', () => {
  it('selective mode (no full flag) omits albumBlocks, libraryArtists, slskdJobs', async () => {
    const { db, close } = await makeTestDb()
    try {
      const backup = await createBackup(db as never)
      expect(backup.data).not.toHaveProperty('albumBlocks')
      expect(backup.data).not.toHaveProperty('libraryArtists')
      expect(backup.data).not.toHaveProperty('slskdJobs')
    } finally {
      await close()
    }
  })

  it('full mode includes all stateful tables and excludes sessions/rateLimitBuckets', async () => {
    const { db, close } = await makeTestDb()
    try {
      const backup = await createBackup(db as never, { includeCaches: true, full: true })
      expect(backup.data).toHaveProperty('albumBlocks')
      expect(backup.data).toHaveProperty('libraryArtists')
      expect(backup.data).toHaveProperty('libraryAlbums')
      expect(backup.data).toHaveProperty('librarySyncState')
      expect(backup.data).toHaveProperty('libraryMatchOverrides')
      expect(backup.data).toHaveProperty('libraryAlbumMatchOverrides')
      expect(backup.data).toHaveProperty('libraryHealthState')
      expect(backup.data).toHaveProperty('recordingArtistCache')
      expect(backup.data).toHaveProperty('slskdJobs')
      expect(backup.data).not.toHaveProperty('sessions')
      expect(backup.data).not.toHaveProperty('rateLimitBuckets')
    } finally {
      await close()
    }
  })

  it('hierarchical genres: child-before-parent in backup restores without FK error', async () => {
    const { db, close } = await makeTestDb()
    const { db: db2, close: close2 } = await makeTestDb()
    try {
      const [parent] = await db
        .insert(schema.genres)
        .values({ name: 'Rock', slug: 'rock', source: 'test' })
        .returning()
      if (!parent) throw new Error('parent genre insert failed')
      await db.insert(schema.genres).values({
        name: 'Indie Rock',
        slug: 'indie-rock',
        source: 'test',
        parentGenreId: parent.id,
      })

      const backup = await createBackup(db as never, { includeCaches: true, full: true })

      // Reverse the genres array so child appears before parent in the backup payload
      if (backup.data.genres && backup.data.genres.length > 1) {
        backup.data.genres = [...backup.data.genres].reverse()
      }

      // Restore into a fresh DB - topo-sort must handle the reversed order
      const result = await restoreBackup(db2 as never, backup, { force: true })
      expect(result.tablesRestored.genres).toBeGreaterThanOrEqual(2)

      // Parent link must survive the round-trip
      const restoredGenres = await db2.select().from(schema.genres)
      const child = restoredGenres.find((g) => g.slug === 'indie-rock')
      const parentRestored = restoredGenres.find((g) => g.slug === 'rock')
      expect(child?.parentGenreId).toBe(parentRestored?.id)
    } finally {
      await close()
      await close2()
    }
  })

  it('round-trip with seeded data restores all full-mode tables', async () => {
    const { db, close } = await makeTestDb()
    const { db: db2, close: close2 } = await makeTestDb()
    try {
      // Insert prerequisite rows
      const [user] = await db
        .insert(schema.users)
        .values({ username: 'backup-test-user', passwordHash: 'x' })
        .returning()
      if (!user) throw new Error('user insert failed')

      const [artist] = await db
        .insert(schema.artists)
        .values({ mbid: '00000000-0000-0000-0000-000000000001', name: 'Test Artist' })
        .returning()
      if (!artist) throw new Error('artist insert failed')

      const [target] = await db
        .insert(schema.targets)
        .values({ type: 'slskd', name: 'Test Target', config: {}, userId: user.id })
        .returning()
      if (!target) throw new Error('target insert failed')

      // Insert rows in each new full-mode table
      await db.insert(schema.albumBlocks).values({
        userId: user.id,
        artistId: artist.id,
        releaseGroupMbid: '00000000-0000-0000-0000-000000000010',
      })
      await db.insert(schema.libraryArtists).values({
        userId: user.id,
        source: 'lidarr',
        sourceArtistId: 'src-001',
        name: 'Test Artist',
        nameNormalized: 'test artist',
      })
      await db.insert(schema.libraryMatchOverrides).values({
        userId: user.id,
        source: 'lidarr',
        sourceArtistId: 'src-001',
        correctMbid: '00000000-0000-0000-0000-000000000001',
      })
      await db.insert(schema.slskdJobs).values({
        userId: user.id,
        targetId: target.id,
        sourceType: 'recommendation',
        workKey: 'wk-test-001',
        artistMbid: '00000000-0000-0000-0000-000000000001',
        artistName: 'Test Artist',
        releaseTitle: 'Test Album',
      })
      await db.insert(schema.libraryAlbums).values({
        userId: user.id,
        source: 'lidarr',
        sourceAlbumId: 'alb-001',
        sourceArtistId: 'src-001',
        title: 'Test Album',
        titleNormalized: 'test album',
      })
      await db.insert(schema.libraryAlbumMatchOverrides).values({
        userId: user.id,
        source: 'lidarr',
        sourceAlbumId: 'alb-001',
        correctAlbumMbid: '00000000-0000-0000-0000-000000000003',
      })
      await db.insert(schema.librarySyncState).values({
        userId: user.id,
        source: 'lidarr',
        lastSyncStatus: 'completed',
      })
      await db.insert(schema.recordingArtistCache).values({
        recordingMbid: '00000000-0000-0000-0000-000000000002',
        artistMbid: '00000000-0000-0000-0000-000000000001',
        artistName: 'Test Artist',
      })
      await db.insert(schema.libraryHealthState).values({ checks: [] })

      const backup = await createBackup(db as never, { includeCaches: true, full: true })
      const result = await restoreBackup(db2 as never, backup, { force: true })

      expect(result.tablesRestored.albumBlocks).toBeGreaterThan(0)
      expect(result.tablesRestored.libraryArtists).toBeGreaterThan(0)
      expect(result.tablesRestored.libraryMatchOverrides).toBeGreaterThan(0)
      expect(result.tablesRestored.slskdJobs).toBeGreaterThan(0)
      expect(result.tablesRestored.libraryAlbums).toBeGreaterThan(0)
      expect(result.tablesRestored.libraryAlbumMatchOverrides).toBeGreaterThan(0)
      expect(result.tablesRestored.librarySyncState).toBeGreaterThan(0)
      expect(result.tablesRestored.recordingArtistCache).toBeGreaterThan(0)
      expect(result.tablesRestored.libraryHealthState).toBeGreaterThan(0)
    } finally {
      await close()
      await close2()
    }
  })
})
