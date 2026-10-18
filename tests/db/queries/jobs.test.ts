// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from '@/db'
import {
  getIntegrationHealth,
  getJobHealth,
  getLatestPlaylistGeneration,
  updateJobMetadata,
} from '@/db/queries/jobs'
import { jobRuns, users } from '@/db/schema'
import { makeTestDb } from '../../helpers/test-db'

/*
 * These are export-verification tests only. The actual query functions build
 * Drizzle query-builder chains (select/from/where/orderBy/limit/offset) that
 * are impractical to mock without recreating the entire builder API. The real
 * coverage comes from E2E / integration tests that hit a live database.
 *
 * Each test verifies the export exists, is a function, and accepts the
 * expected number of parameters (db + filters/args).
 */

describe('job queries', () => {
  it('exports listJobs(db, filters?) with 1 required param', async () => {
    const mod = await import('@/db/queries/jobs')
    expect(typeof mod.listJobs).toBe('function')
    expect(mod.listJobs).toHaveLength(1)
  })

  it('exports getJobById(db, id) with 2 params', async () => {
    const mod = await import('@/db/queries/jobs')
    expect(typeof mod.getJobById).toBe('function')
    expect(mod.getJobById).toHaveLength(2)
  })

  it('exports getJobHealth(db, nextPipelineRun) with 2 params', async () => {
    const mod = await import('@/db/queries/jobs')
    expect(typeof mod.getJobHealth).toBe('function')
    expect(mod.getJobHealth).toHaveLength(2)
  })

  it('exports getJobsForSubscription(db, subscriptionId, limit?) with 2 required params', async () => {
    const mod = await import('@/db/queries/jobs')
    expect(typeof mod.getJobsForSubscription).toBe('function')
    expect(mod.getJobsForSubscription).toHaveLength(2)
  })

  it('exports ListJobsFilters type (used by listJobs)', async () => {
    const mod = await import('@/db/queries/jobs')
    // Verify listJobs accepts an empty filters object without throwing at import time
    expect(mod.listJobs).toBeDefined()
  })

  it('exports HealthSummary type (returned by getJobHealth)', async () => {
    const mod = await import('@/db/queries/jobs')
    expect(mod.getJobHealth).toBeDefined()
  })
})

describe('job queries on migrated PGlite', () => {
  let db: Database
  let close: () => Promise<void>
  let ownerId: number
  let otherId: number
  const resolution = {
    requestedArtistCount: 2,
    resolvedArtistCount: 1,
    includedArtistCount: 1,
    trackCount: 1,
    outcomes: [
      {
        artistName: 'Included',
        artistMbid: 'artist-1',
        status: 'resolved',
        resolvedTrackCount: 1,
        includedTrackCount: 1,
      },
      { artistName: 'Missing', status: 'unmatched', resolvedTrackCount: 0, includedTrackCount: 0 },
    ],
  }
  beforeAll(async () => {
    const result = await makeTestDb()
    db = result.db as unknown as Database
    close = result.close
    const rows = await db
      .insert(users)
      .values([
        { username: 'playlist-owner', passwordHash: 'hash' },
        { username: 'playlist-other', passwordHash: 'hash' },
      ])
      .returning({ id: users.id })
    ownerId = rows[0]?.id ?? 0
    otherId = rows[1]?.id ?? 0
  }, 30000)
  afterAll(async () => {
    await close?.()
  })
  beforeEach(async () => {
    await db.delete(jobRuns)
  })

  it('omits sources with only skipped results for every skip reason', async () => {
    await db.insert(jobRuns).values({
      type: 'pipeline',
      status: 'completed',
      sourceResults: {
        unconfigured: { status: 'skipped', reason: 'not_configured' },
        unsupported: { status: 'skipped', reason: 'unsupported_capability' },
        explicit: { status: 'skipped', reason: 'explicit_run' },
        seedless: { status: 'skipped', reason: 'no_seeds' },
      },
    })

    expect((await getJobHealth(db, null)).sources).toEqual({})
  })

  it('keeps successful sources healthy across skips, including zero-artist results', async () => {
    await db.insert(jobRuns).values([
      {
        type: 'pipeline',
        status: 'completed',
        sourceResults: {
          unconfigured: { status: 'skipped', reason: 'not_configured' },
          unsupported: { status: 'skipped', reason: 'unsupported_capability' },
          explicit: { status: 'skipped', reason: 'explicit_run' },
          seedless: { status: 'skipped', reason: 'no_seeds' },
        },
      },
      {
        type: 'quick_discover',
        status: 'completed',
        sourceResults: {
          unconfigured: { status: 'ok', artists: 2 },
          unsupported: { status: 'ok', artists: 2 },
          explicit: { status: 'ok', artists: 2 },
          seedless: { status: 'ok', artists: 0 },
        },
      },
    ])

    expect((await getJobHealth(db, null)).sources).toEqual({
      unconfigured: 'ok',
      unsupported: 'ok',
      explicit: 'ok',
      seedless: 'ok',
    })
  })

  it('uses only attempted results for degraded and failing thresholds', async () => {
    await db.insert(jobRuns).values([
      {
        type: 'pipeline',
        status: 'completed',
        sourceResults: {
          degraded: { status: 'error', error: 'unavailable' },
          boundary: { status: 'error', error: 'unavailable' },
          errorOnly: { status: 'error', error: 'unavailable' },
        },
      },
      {
        type: 'quick_discover',
        status: 'completed',
        sourceResults: {
          degraded: { status: 'ok', artists: 0 },
          boundary: { status: 'ok', artists: 1 },
          errorOnly: { status: 'skipped', reason: 'not_configured' },
        },
      },
      {
        type: 'pipeline',
        status: 'completed',
        sourceResults: {
          degraded: { status: 'ok', artists: 1 },
          boundary: { status: 'skipped', reason: 'explicit_run' },
          errorOnly: { status: 'skipped', reason: 'no_seeds' },
        },
      },
      {
        type: 'quick_discover',
        status: 'completed',
        sourceResults: {
          degraded: { status: 'skipped', reason: 'unsupported_capability' },
          boundary: { status: 'skipped', reason: 'no_seeds' },
          errorOnly: { status: 'skipped', reason: 'explicit_run' },
        },
      },
    ])

    expect((await getJobHealth(db, null)).sources).toEqual({
      degraded: 'degraded',
      boundary: 'failing',
      errorOnly: 'failing',
    })
  })

  it('keeps the latest 20 eligible runs and the 24-hour job-type filters', async () => {
    const now = Date.now()
    await db.insert(jobRuns).values([
      ...Array.from({ length: 20 }, (_, index) => ({
        type: index % 2 === 0 ? 'pipeline' : 'quick_discover',
        status: 'completed',
        startedAt: new Date(now - (60 + index) * 60_000),
        sourceResults: { recent: { status: 'skipped', reason: 'no_seeds' } },
      })),
      ...Array.from({ length: 20 }, (_, index) => ({
        type: 'pipeline',
        status: 'completed',
        startedAt: new Date(now - (index + 1) * 60_000),
        sourceResults: null,
      })),
      {
        type: 'pipeline',
        status: 'completed',
        startedAt: new Date(now - 2 * 60 * 60_000),
        sourceResults: { olderAttempt: { status: 'error', error: 'unavailable' } },
      },
    ])

    expect((await getJobHealth(db, null)).sources).toEqual({})

    await db.delete(jobRuns)
    await db.insert(jobRuns).values([
      {
        type: 'pipeline',
        status: 'completed',
        startedAt: new Date(now - 60_000),
        sourceResults: { recent: { status: 'ok', artists: 1 } },
      },
      {
        type: 'quick_discover',
        status: 'completed',
        startedAt: new Date(now - 25 * 60 * 60_000),
        sourceResults: { expired: { status: 'error', error: 'unavailable' } },
      },
      ...['subscription', 'target', 'playlist', 'library_sync'].map((type) => ({
        type,
        status: 'completed',
        startedAt: new Date(now),
        sourceResults: { unrelated: { status: 'error', error: 'unavailable' } },
      })),
    ])

    expect((await getJobHealth(db, null)).sources).toEqual({ recent: 'ok' })
  })

  it('reports last success and last error per integration from recorded runs', async () => {
    const now = Date.now()
    const at = (hoursAgo: number) => new Date(now - hoursAgo * 60 * 60 * 1000)
    await db.insert(jobRuns).values([
      {
        type: 'target',
        status: 'completed',
        completedAt: at(5),
        metadata: { targetType: 'lidarr' },
      },
      {
        type: 'target',
        status: 'failed',
        completedAt: at(2),
        error: 'Lidarr down: http://lidarr/api?apikey=hunter22',
        metadata: { targetType: 'lidarr' },
      },
      {
        type: 'target',
        status: 'failed',
        completedAt: at(3),
        error: 'older failure',
        metadata: { targetType: 'lidarr' },
      },
      {
        type: 'target',
        status: 'completed',
        completedAt: at(1),
        metadata: { targetType: 'slskd', skipped: true },
      },
      {
        type: 'target',
        status: 'completed',
        completedAt: at(1),
        metadata: { writeBackService: 'lastfm', operation: 'love' },
      },
      {
        type: 'library_sync',
        status: 'completed',
        completedAt: at(4),
        metadata: { source: 'plex' },
      },
      {
        type: 'subscription',
        status: 'failed',
        completedAt: at(1),
        error: 'feed gone',
        metadata: { adapterType: 'rss' },
      },
      { type: 'target', status: 'running', metadata: { targetType: 'emby' } },
      {
        type: 'pipeline',
        status: 'completed',
        completedAt: at(6),
        sourceResults: {
          lastfm: { status: 'error', error: 'rate limited' },
          ai: { status: 'ok', artists: 3 },
          deezer: { status: 'skipped', reason: 'not_configured' },
        },
      },
      {
        type: 'quick_discover',
        status: 'completed',
        completedAt: at(1),
        sourceResults: { lastfm: { status: 'ok', artists: 0 } },
      },
    ])

    const integrations = await getIntegrationHealth(db)
    const byKey = Object.fromEntries(integrations.map((i) => [`${i.kind}:${i.name}`, i]))

    expect(Object.keys(byKey).sort()).toEqual([
      'library:plex',
      'scrobbler:lastfm',
      'source:ai',
      'source:lastfm',
      'subscription:rss',
      'target:lidarr',
    ])
    expect(byKey['target:lidarr']).toEqual({
      kind: 'target',
      name: 'lidarr',
      status: 'failing',
      lastSuccess: at(5).toISOString(),
      lastError: {
        at: at(2).toISOString(),
        message: 'Lidarr down: http://lidarr/api?apikey=[redacted]',
      },
    })
    expect(byKey['source:lastfm']).toMatchObject({
      status: 'ok',
      lastError: { message: 'rate limited' },
    })
    expect(byKey['subscription:rss']).toMatchObject({ status: 'failing', lastSuccess: null })
    expect(byKey['library:plex']).toMatchObject({ status: 'ok', lastError: null })
    expect((await getJobHealth(db, null)).integrations).toEqual(integrations)
  })

  it('ignores integration outcomes older than the health window', async () => {
    await db.insert(jobRuns).values({
      type: 'target',
      status: 'completed',
      startedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
      metadata: { targetType: 'lidarr' },
    })

    expect(await getIntegrationHealth(db)).toEqual([])
  })

  it('merges metadata and returns only safe generation fields', async () => {
    const [job] = await db
      .insert(jobRuns)
      .values({
        type: 'playlist',
        status: 'failed',
        userId: ownerId,
        error: 'secret error',
        metadata: { playlistId: 7, token: 'secret', preserved: true },
      })
      .returning({ id: jobRuns.id })
    if (!job) throw new Error('Missing test job')
    await updateJobMetadata(db, job.id, {
      playlistResolution: {
        ...resolution,
        token: 'secret',
        outcomes: resolution.outcomes.map((outcome) => ({ ...outcome, error: 'private error' })),
      },
    })
    const generation = await getLatestPlaylistGeneration(db, 7, ownerId)
    expect(generation?.resolution).toEqual(resolution)
    expect(Object.keys(generation ?? {}).sort()).toEqual([
      'completedAt',
      'exports',
      'jobId',
      'resolution',
      'startedAt',
      'status',
    ])
    expect(JSON.stringify(generation)).not.toContain('secret')
    const [stored] = await db.select().from(jobRuns)
    expect(stored?.metadata).toMatchObject({ playlistId: 7, preserved: true, token: 'secret' })
  })

  it('returns the latest owner run even when it has no summary and ignores malformed IDs', async () => {
    const startedAt = new Date('2026-01-01')
    await db.insert(jobRuns).values([
      {
        type: 'playlist',
        status: 'completed',
        userId: ownerId,
        startedAt,
        metadata: { playlistId: 7, playlistResolution: resolution },
      },
      {
        type: 'playlist',
        status: 'running',
        userId: ownerId,
        startedAt,
        metadata: { playlistId: '7' },
      },
      { type: 'playlist', status: 'failed', userId: otherId, metadata: { playlistId: 7 } },
      { type: 'pipeline', status: 'failed', userId: ownerId, metadata: { playlistId: 7 } },
      {
        type: 'playlist',
        status: 'failed',
        userId: ownerId,
        metadata: { playlistId: 'malformed' },
      },
    ])
    expect(await getLatestPlaylistGeneration(db, 7, ownerId)).toMatchObject({
      status: 'running',
      resolution: null,
    })
    expect(await getLatestPlaylistGeneration(db, 8, ownerId)).toBeNull()
    expect(await getLatestPlaylistGeneration(db, 7, 999)).toBeNull()
  })

  it('returns no summary for invalid persisted outcomes', async () => {
    await db.insert(jobRuns).values({
      type: 'playlist',
      status: 'completed',
      userId: ownerId,
      metadata: {
        playlistId: 7,
        playlistResolution: {
          ...resolution,
          outcomes: [
            {
              artistName: 'Missing',
              status: 'unmatched',
              resolvedTrackCount: -1,
              includedTrackCount: 0,
            },
          ],
        },
      },
    })
    expect(await getLatestPlaylistGeneration(db, 7, ownerId)).toMatchObject({
      status: 'completed',
      resolution: null,
    })
  })

  it('projects valid per-target export outcomes and drops malformed ones', async () => {
    const submitted = {
      targetId: 1,
      targetName: 'Plex',
      targetType: 'plex-playlist',
      status: 'submitted',
      verified: true,
      itemsAdded: 3,
      itemsSkipped: 0,
    }
    const failed = {
      targetId: 2,
      targetName: 'Spotify',
      targetType: 'spotify-playlist',
      status: 'failed',
      verified: false,
      error: 'Spotify API 500',
    }
    await db.insert(jobRuns).values([
      {
        type: 'playlist',
        status: 'failed',
        userId: ownerId,
        startedAt: new Date('2026-01-02'),
        metadata: { playlistId: 7, playlistExports: [{ ...submitted, token: 'secret' }, failed] },
      },
      {
        type: 'playlist',
        status: 'failed',
        userId: ownerId,
        startedAt: new Date('2026-01-01'),
        metadata: { playlistId: 8, playlistExports: [{ ...failed, status: 'done' }] },
      },
    ])
    const generation = await getLatestPlaylistGeneration(db, 7, ownerId)
    expect(generation?.exports).toEqual([submitted, failed])
    expect(JSON.stringify(generation)).not.toContain('secret')
    expect((await getLatestPlaylistGeneration(db, 8, ownerId))?.exports).toBeNull()
  })
})
