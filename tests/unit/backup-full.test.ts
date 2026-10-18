import { describe, expect, it, vi } from 'vitest'
import { initEncryption } from '@/core/crypto'
import {
  BACKUP_TABLE_BY_KEY,
  createBackup,
  createBackupSnapshot,
  PartialBackupConflictError,
  restoreBackup,
} from '@/core/ops/backup'
import { initializeDigestDeliveryPositions } from '@/db/queries/settings'
import * as schema from '@/db/schema'
import { makeTestDb } from '../helpers/test-db'

// PGlite WASM cold-start + migrations can exceed the 5s default under full-suite
// parallel contention; these tests pass in isolation. Give them headroom.
vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 })

describe('backup full-fidelity', () => {
  it('explicit selective mode retains artist dependencies but omits full-state tables', async () => {
    const { db, close } = await makeTestDb()
    try {
      const backup = await createBackup(db as never, { full: false })
      expect(backup.data).not.toHaveProperty('albumBlocks')
      expect(backup.data).not.toHaveProperty('libraryArtists')
      expect(backup.data).not.toHaveProperty('slskdJobs')
      expect(backup.data).toHaveProperty('artists')
      expect(backup.data).toHaveProperty('artistGenreAliases')
      expect(backup.data).toHaveProperty('genres')
      expect(backup.data).toHaveProperty('playlistExports')
    } finally {
      await close()
    }
  })

  it('default snapshot includes all persistent tables and excludes ephemeral state', async () => {
    const { db, close } = await makeTestDb()
    try {
      const backup = await createBackupSnapshot(db as never)
      expect(backup.data).toHaveProperty('albumBlocks')
      expect(backup.data).toHaveProperty('playlistExports')
      expect(backup.data).toHaveProperty('artistGenreAliases')
      expect(backup.data).toHaveProperty('libraryArtists')
      expect(backup.data).toHaveProperty('libraryAlbums')
      expect(backup.data).toHaveProperty('librarySyncState')
      expect(backup.data).toHaveProperty('libraryMatchOverrides')
      expect(backup.data).toHaveProperty('libraryAlbumMatchOverrides')
      expect(backup.data).toHaveProperty('libraryHealthState')
      expect(backup.data).toHaveProperty('recordingArtistCache')
      expect(backup.data).toHaveProperty('slskdJobs')
      expect(backup.data).not.toHaveProperty('oidcTokens')
      expect(backup.data).not.toHaveProperty('sessions')
      expect(backup.data).not.toHaveProperty('rateLimitBuckets')
      expect(backup.data).not.toHaveProperty('oauthPendingAuths')
      expect(backup.data).not.toHaveProperty('artistMetadata')
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

  it('cyclic genres in the payload terminate instead of overflowing the stack', async () => {
    const { db, close } = await makeTestDb()
    try {
      const backup = await createBackup(db as never, { includeCaches: true, full: true })
      // Two genres that reference each other — impossible in real data (the DB FK
      // prevents it), but the topo-sort must terminate rather than recurse forever.
      // The pre-fix sort marked nodes visited only after recursing, so this input
      // stack-overflowed. With the fix it completes; the two rows insert in a single
      // multi-row statement, so the immediate FK is satisfied at statement end.
      backup.data.genres = [
        { id: 1, name: 'A', slug: 'cyc-a', source: 'test', parentGenreId: 2 },
        { id: 2, name: 'B', slug: 'cyc-b', source: 'test', parentGenreId: 1 },
      ]
      const result = await restoreBackup(db as never, backup, { force: true })
      expect(result.tablesRestored.genres).toBe(2)
    } finally {
      await close()
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

  // Seed one distinctive row in every full-mode table and return the FK anchors.
  async function seedFullTables(db: Awaited<ReturnType<typeof makeTestDb>>['db']) {
    const [user] = await db
      .insert(schema.users)
      .values({ username: 'fidelity-user', passwordHash: 'x' })
      .returning()
    if (!user) throw new Error('user insert failed')
    const [artist] = await db
      .insert(schema.artists)
      .values({ mbid: '00000000-0000-0000-0000-0000000000a1', name: 'Fidelity Artist' })
      .returning()
    if (!artist) throw new Error('artist insert failed')
    const [target] = await db
      .insert(schema.targets)
      .values({ type: 'slskd', name: 'Fidelity Target', config: {}, userId: user.id })
      .returning()
    if (!target) throw new Error('target insert failed')

    await db.insert(schema.settings).values({
      setupComplete: true,
      aiModel: 'recovery-model',
      digestDeliveryPositions: { saved: '2026-10-01T00:00:00.000Z', pending: null },
    })
    await db.insert(schema.oauthTokens).values({
      userId: user.id,
      provider: 'spotify',
      accessToken: 'saved-token',
      expiresAt: new Date('2030-01-01T00:00:00Z'),
    })
    const [subscription] = await db
      .insert(schema.subscriptions)
      .values({
        userId: user.id,
        name: 'Fidelity Subscription',
        sourceType: 'playlist',
        sourceProvider: 'spotify',
        sourceConfig: { playlistId: 'saved-playlist' },
        cron: '0 0 * * *',
      })
      .returning()
    if (!subscription) throw new Error('subscription insert failed')
    const [batch] = await db
      .insert(schema.recommendationBatches)
      .values({
        subscriptionId: subscription.id,
        status: 'completed',
      })
      .returning()
    if (!batch) throw new Error('batch insert failed')
    await db.insert(schema.jobRuns).values({
      userId: user.id,
      subscriptionId: subscription.id,
      batchId: batch.id,
      type: 'subscription',
      status: 'completed',
      metadata: { trigger: 'subscription' },
    })
    const [recommendation] = await db
      .insert(schema.recommendations)
      .values({
        userId: user.id,
        artistId: artist.id,
        batchId: batch.id,
        score: 0.75,
        status: 'approved',
      })
      .returning()
    if (!recommendation) throw new Error('recommendation insert failed')
    await db.insert(schema.approvalRequests).values({
      recommendationId: recommendation.id,
      userId: user.id,
      status: 'approved',
      options: { monitorOption: 'all' },
      note: 'fidelity note',
      decidedBy: user.id,
      decidedAt: new Date('2026-01-02T00:00:00Z'),
    })
    const [playlist] = await db
      .insert(schema.playlists)
      .values({
        userId: user.id,
        name: 'Fidelity Playlist',
        id: 61,
        strategy: 'weekly_digest',
        targetIds: [target.id],
      })
      .returning()
    if (!playlist) throw new Error('playlist insert failed')
    await db.insert(schema.playlistExports).values({
      id: 91,
      playlistId: playlist.id,
      targetId: target.id,
      remoteScope: 'v1:stored-scope',
      remotePlaylistId: 'fidelity-remote',
      state: 'linked',
    })
    await db.insert(schema.playlistTracks).values({
      playlistId: playlist.id,
      artistName: artist.name,
      trackName: 'Fidelity Track',
      position: 0,
    })
    await db.insert(schema.artistBlocks).values({ userId: user.id, artistId: artist.id })
    await db.insert(schema.artistGenreAliases).values({
      source: 'subsonic',
      nameNormalized: 'fidelity artist',
      mbid: artist.mbid,
    })
    await db
      .insert(schema.genres)
      .values({ name: 'Fidelity Genre', slug: 'fidelity', source: 'test' })
    await db.insert(schema.artistMetadata).values({
      name: artist.name,
      nameNormalized: 'fidelity artist',
      spotifyPopularity: 42,
    })

    await db.insert(schema.albumBlocks).values({
      userId: user.id,
      artistId: artist.id,
      releaseGroupMbid: '00000000-0000-0000-0000-0000000000b1',
    })
    await db.insert(schema.libraryArtists).values({
      userId: user.id,
      source: 'lidarr',
      sourceArtistId: 'fid-art-1',
      name: 'Fidelity Artist',
      nameNormalized: 'fidelity artist',
    })
    await db.insert(schema.libraryAlbums).values({
      userId: user.id,
      source: 'lidarr',
      sourceAlbumId: 'fid-alb-1',
      sourceArtistId: 'fid-art-1',
      title: 'Fidelity Album',
      titleNormalized: 'fidelity album',
    })
    await db.insert(schema.librarySyncState).values({
      userId: user.id,
      source: 'lidarr',
      lastSyncStatus: 'completed',
    })
    await db.insert(schema.libraryMatchOverrides).values({
      userId: user.id,
      source: 'lidarr',
      sourceArtistId: 'fid-art-1',
      correctMbid: '00000000-0000-0000-0000-0000000000a1',
    })
    await db.insert(schema.libraryAlbumMatchOverrides).values({
      userId: user.id,
      source: 'lidarr',
      sourceAlbumId: 'fid-alb-1',
      correctAlbumMbid: '00000000-0000-0000-0000-0000000000c1',
    })
    await db.insert(schema.libraryHealthState).values({
      checks: [
        {
          id: 'unmonitored',
          name: 'Unmonitored',
          description: 'probe',
          severity: 'info',
          count: 0,
          items: [],
          fixable: false,
        },
      ],
    })
    await db.insert(schema.recordingArtistCache).values({
      recordingMbid: '00000000-0000-0000-0000-0000000000d1',
      artistMbid: '00000000-0000-0000-0000-0000000000a1',
      artistName: 'Fidelity Artist',
    })
    await db.insert(schema.slskdJobs).values({
      userId: user.id,
      targetId: target.id,
      recommendationId: recommendation.id,
      sourceType: 'recommendation',
      workKey: 'fid-wk-1',
      artistMbid: '00000000-0000-0000-0000-0000000000a1',
      artistName: 'Fidelity Artist',
      releaseTitle: 'Fidelity Album',
    })
    return { user, artist, target }
  }

  it('round-trips every persistent table and relationship using the default snapshot', async () => {
    const { db, close } = await makeTestDb()
    const { db: db2, close: close2 } = await makeTestDb()
    try {
      await seedFullTables(db)
      const backup = await createBackupSnapshot(db as never)
      await restoreBackup(db2 as never, backup, { force: true })

      for (const [key, table] of Object.entries(BACKUP_TABLE_BY_KEY)) {
        if (key === 'artistMetadata') continue
        const restoredRows = await db2.select().from(table)
        let expected = backup.data[key as keyof typeof backup.data] as unknown[]
        if (key === 'approvalRequests') {
          // Natural-key remap fields exist only in the snapshot, not in the table.
          expected = (expected as Record<string, unknown>[]).map(
            ({ requesterUsername, deciderUsername, recommendationKey, ...row }) => {
              expect(requesterUsername).toBeTruthy()
              expect(deciderUsername).toBeTruthy()
              expect(recommendationKey).toBeTruthy()
              return row
            },
          )
        }
        expect(JSON.parse(JSON.stringify(restoredRows)), key).toEqual(
          JSON.parse(JSON.stringify(expected)),
        )
        expect(restoredRows.length, key).toBeGreaterThan(0)
      }
      expect(await db2.select().from(schema.artistMetadata)).toEqual([])
      const cachedBackup = await createBackupSnapshot(db as never, { includeCaches: true })
      await restoreBackup(db2 as never, cachedBackup, { force: true })
      expect(await db2.select().from(schema.artistMetadata)).toMatchObject([
        { nameNormalized: 'fidelity artist', spotifyPopularity: 42 },
      ])

      // Select each table back out of the restored DB and assert the distinctive
      // field survived the JSON serialize -> restore round-trip intact.
      const [ab] = await db2.select().from(schema.albumBlocks)
      expect(ab?.releaseGroupMbid).toBe('00000000-0000-0000-0000-0000000000b1')

      const [la] = await db2.select().from(schema.libraryArtists)
      expect(la).toMatchObject({ sourceArtistId: 'fid-art-1', name: 'Fidelity Artist' })

      const [lal] = await db2.select().from(schema.libraryAlbums)
      expect(lal).toMatchObject({ sourceAlbumId: 'fid-alb-1', title: 'Fidelity Album' })

      const [lss] = await db2.select().from(schema.librarySyncState)
      expect(lss?.lastSyncStatus).toBe('completed')

      const [lmo] = await db2.select().from(schema.libraryMatchOverrides)
      expect(lmo?.correctMbid).toBe('00000000-0000-0000-0000-0000000000a1')

      const [lamo] = await db2.select().from(schema.libraryAlbumMatchOverrides)
      expect(lamo?.correctAlbumMbid).toBe('00000000-0000-0000-0000-0000000000c1')

      const [lhs] = await db2.select().from(schema.libraryHealthState)
      expect(lhs?.checks).toHaveLength(1)
      expect(lhs?.checks?.[0]).toMatchObject({ id: 'unmonitored', description: 'probe' })

      const [rac] = await db2.select().from(schema.recordingArtistCache)
      expect(rac).toMatchObject({
        recordingMbid: '00000000-0000-0000-0000-0000000000d1',
        artistName: 'Fidelity Artist',
      })

      const [job] = await db2.select().from(schema.slskdJobs)
      expect(job).toMatchObject({ workKey: 'fid-wk-1', releaseTitle: 'Fidelity Album' })
    } finally {
      await close()
      await close2()
    }
  })

  it('restores an old backup without delivery positions as NULL for legacy bootstrap', async () => {
    const { db, close } = await makeTestDb()
    const { db: destination, close: closeDestination } = await makeTestDb()
    try {
      const legacy = new Date('2026-10-01T00:00:00.000Z')
      await db.insert(schema.settings).values({ id: 1, digestLastSentAt: legacy })
      const backup = await createBackupSnapshot(db as never)
      delete backup.data.playlistExports
      for (const row of backup.data.settings ?? []) delete row.digestDeliveryPositions
      await destination.insert(schema.settings).values({
        id: 1,
        digestDeliveryPositions: { stale: '2026-10-02T00:00:00.000Z' },
      })
      await restoreBackup(destination as never, backup, { force: true })
      const [restored] = await destination.select().from(schema.settings)
      expect(restored?.digestDeliveryPositions).toBeNull()
      expect(await initializeDigestDeliveryPositions(destination as never, ['restored'])).toEqual({
        restored: legacy.toISOString(),
      })
    } finally {
      await close()
      await closeDestination()
    }
  })

  it('restoring over a populated target overwrites natural-key conflicts and clears stale rows', async () => {
    const { db, close } = await makeTestDb() // backup source
    const { db: db2, close: close2 } = await makeTestDb() // populated restore target
    try {
      await seedFullTables(db)
      const backup = await createBackup(db as never, { includeCaches: true, full: true })

      // Pre-populate db2 so restore must reconcile against existing data:
      //   - a recordingArtistCache row sharing the backup's natural key (recordingMbid)
      //     but carrying STALE content -> backup must win.
      //   - a libraryArtists row absent from the backup -> must be cleared.
      const [u2] = await db2
        .insert(schema.users)
        .values({ username: 'preexisting', passwordHash: 'x' })
        .returning()
      if (!u2) throw new Error('db2 user insert failed')
      await db2.insert(schema.recordingArtistCache).values({
        recordingMbid: '00000000-0000-0000-0000-0000000000d1', // same key as backup
        artistMbid: '00000000-0000-0000-0000-0000000000ff',
        artistName: 'STALE NAME',
      })
      await db2.insert(schema.libraryArtists).values({
        userId: u2.id,
        source: 'lidarr',
        sourceArtistId: 'stale-art',
        name: 'Stale Artist',
        nameNormalized: 'stale artist',
      })

      await restoreBackup(db2 as never, backup, { force: true })

      // Natural-key conflict: the backup row replaced the stale one (no duplicate).
      const cache = await db2.select().from(schema.recordingArtistCache)
      expect(cache).toHaveLength(1)
      expect(cache[0]?.artistName).toBe('Fidelity Artist')

      // Stale-row clear: the pre-existing libraryArtists row is gone; only the
      // backup's row remains.
      const libArtists = await db2.select().from(schema.libraryArtists)
      expect(libArtists).toHaveLength(1)
      expect(libArtists[0]?.sourceArtistId).toBe('fid-art-1')
    } finally {
      await close()
      await close2()
    }
  })

  it.each([false, true])(
    'rejects destructive legacy partial restores unchanged (force=%s)',
    async (force) => {
      const { db, close } = await makeTestDb()
      try {
        await seedFullTables(db)
        const before = await createBackupSnapshot(db as never, { includeCaches: true })
        const backup = structuredClone(before)
        const legacyData = backup.data as Partial<typeof backup.data>
        delete backup.data.playlistExports
        delete backup.data.libraryArtists
        delete legacyData.jobRuns
        delete legacyData.recommendations
        if (force) {
          initEncryption('restore-conflict-key')
          backup.encryptionKeyHash = 'sha256:old-key'
        }

        await expect(restoreBackup(db as never, backup, { force })).rejects.toMatchObject({
          name: 'PartialBackupConflictError',
          affectedTables: expect.arrayContaining([
            'libraryArtists',
            'jobRuns',
            'recommendations',
            'playlistExports',
          ]),
        })
        const after = await createBackupSnapshot(db as never, { includeCaches: true })
        expect(after.data).toEqual(before.data)
      } finally {
        initEncryption(undefined)
        await close()
      }
    },
  )

  it('rejects missing artist dependencies before changing the destination and accepts retained artists', async () => {
    const { db, close } = await makeTestDb()
    const { db: destination, close: closeDestination } = await makeTestDb()
    try {
      await seedFullTables(db)
      const backup = await createBackupSnapshot(db as never)
      delete backup.data.artists
      await destination.insert(schema.users).values({ username: 'survivor', passwordHash: 'x' })
      const before = await createBackupSnapshot(destination as never)
      await expect(restoreBackup(destination as never, backup)).rejects.toBeInstanceOf(
        PartialBackupConflictError,
      )
      expect((await createBackupSnapshot(destination as never)).data).toEqual(before.data)

      const retainedArtists = await db.select().from(schema.artists)
      await destination.insert(schema.artists).values(retainedArtists)
      await restoreBackup(destination as never, backup)
      expect(await destination.select().from(schema.artists)).toEqual(retainedArtists)
      expect(await destination.select().from(schema.recommendations)).toMatchObject([
        { artistId: retainedArtists[0]?.id, status: 'approved' },
      ])
    } finally {
      await close()
      await closeDestination()
    }
  })

  it('restores safe legacy partial data while retaining omitted global library state', async () => {
    const { db, close } = await makeTestDb()
    const { db: destination, close: closeDestination } = await makeTestDb()
    try {
      await db.insert(schema.users).values({ username: 'legacy', passwordHash: 'x' })
      const backup = await createBackup(db as never, { full: false })
      delete backup.data.artists
      delete backup.data.artistGenreAliases
      delete backup.data.genres
      await destination.insert(schema.libraryArtists).values({
        source: 'lidarr',
        sourceArtistId: 'global',
        name: 'Global',
        nameNormalized: 'global',
      })
      await restoreBackup(destination as never, backup)
      expect(await destination.select().from(schema.users)).toMatchObject([{ username: 'legacy' }])
      expect(await destination.select().from(schema.libraryArtists)).toMatchObject([
        { userId: null, sourceArtistId: 'global' },
      ])
    } finally {
      await close()
      await closeDestination()
    }
  })

  it('rolls back the whole full-mode restore when a later full-table insert fails', async () => {
    const { db, close } = await makeTestDb()
    try {
      // Pre-existing data that an atomic rollback must leave untouched.
      const [survivor] = await db
        .insert(schema.users)
        .values({ username: 'survivor', passwordHash: 'x' })
        .returning()
      if (!survivor) throw new Error('survivor insert failed')
      await db.insert(schema.libraryArtists).values({
        userId: survivor.id,
        source: 'lidarr',
        sourceArtistId: 'survivor-art',
        name: 'Survivor Artist',
        nameNormalized: 'survivor artist',
      })

      // A full-mode backup whose slskdJobs row points at a non-existent target FK.
      // slskdJobs restores last, so the clear + every prior insert must roll back.
      const backup = await createBackup(db as never, { includeCaches: true, full: true })
      backup.data.users = [{ id: 99, username: 'from-backup', passwordHash: 'x', isAdmin: false }]
      backup.data.libraryArtists = []
      backup.data.slskdJobs = [
        {
          id: 1,
          userId: 99,
          targetId: 987654, // no such target -> FK violation
          sourceType: 'recommendation',
          workKey: 'rollback-wk',
          artistMbid: '00000000-0000-0000-0000-0000000000a1',
          artistName: 'X',
          releaseTitle: 'Y',
        },
      ]

      await expect(restoreBackup(db as never, backup, { force: true })).rejects.toThrow()

      // Rollback intact: the original user + libraryArtists row survive, and the
      // backup's user never landed.
      const users = await db.select().from(schema.users)
      expect(users).toHaveLength(1)
      expect(users[0]?.username).toBe('survivor')
      const libArtists = await db.select().from(schema.libraryArtists)
      expect(libArtists).toHaveLength(1)
      expect(libArtists[0]?.sourceArtistId).toBe('survivor-art')
    } finally {
      await close()
    }
  })
})
