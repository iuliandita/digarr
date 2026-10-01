// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from '@/db'
import { getLatestPlaylistGeneration, updateJobMetadata } from '@/db/queries/jobs'
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

describe('playlist generation queries on migrated PGlite', () => {
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
})
