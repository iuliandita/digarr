// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from '@/db'
import { getPendingPlayability } from '@/db/queries/playlists'
import {
  artists,
  jobRuns,
  playlists,
  recommendationBatches,
  recommendations,
  users,
} from '@/db/schema'
import { makeTestDb } from '../../helpers/test-db'

const mbid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`

function outcome(n: number, status: string, titleOnly = false) {
  return {
    artistName: `Artist ${n}`,
    artistMbid: mbid(n),
    status,
    resolvedTrackCount: status === 'resolved' ? 1 : 0,
    includedTrackCount: status === 'resolved' ? 1 : 0,
    ...(titleOnly ? { titleOnly: true } : {}),
  }
}

function resolution(outcomes: ReturnType<typeof outcome>[]) {
  return {
    requestedArtistCount: outcomes.length,
    resolvedArtistCount: 0,
    includedArtistCount: 0,
    trackCount: 0,
    outcomes,
  }
}

describe('getPendingPlayability on migrated PGlite', () => {
  let db: Database
  let close: () => Promise<void>
  let ownerId: number
  let otherId: number
  let batchId: number

  beforeAll(async () => {
    const result = await makeTestDb()
    db = result.db as unknown as Database
    close = result.close
    const rows = await db
      .insert(users)
      .values([
        { username: 'owner', passwordHash: 'hash' },
        { username: 'other', passwordHash: 'hash' },
      ])
      .returning({ id: users.id })
    ownerId = rows[0]?.id ?? 0
    otherId = rows[1]?.id ?? 0
    const [batch] = await db.insert(recommendationBatches).values({}).returning()
    batchId = batch?.id ?? 0
  }, 30000)
  afterAll(async () => {
    await close?.()
  })
  beforeEach(async () => {
    await db.delete(jobRuns)
    await db.delete(recommendations)
    await db.delete(playlists)
    await db.delete(artists)
  })

  async function pending(...ns: number[]) {
    const inserted = await db
      .insert(artists)
      .values(ns.map((n) => ({ mbid: mbid(n), name: `Artist ${n}` })))
      .returning({ id: artists.id })
    await db
      .insert(recommendations)
      .values(inserted.map(({ id }) => ({ userId: ownerId, artistId: id, batchId, score: 0.5 })))
  }

  async function playlist(userId: number, strategy: string) {
    const [row] = await db
      .insert(playlists)
      .values({ userId, name: strategy, strategy })
      .returning({ id: playlists.id })
    return row?.id ?? 0
  }

  async function run(
    userId: number,
    playlistId: number,
    startedAt: string,
    outcomes: ReturnType<typeof outcome>[],
  ) {
    await db.insert(jobRuns).values({
      type: 'playlist',
      status: 'completed',
      userId,
      startedAt: new Date(startedAt),
      metadata: { playlistId, playlistResolution: resolution(outcomes) },
    })
  }

  it('returns zeros for an empty library', async () => {
    expect(await getPendingPlayability(db, ownerId)).toEqual({
      pendingArtists: 0,
      withTrack: 0,
      withoutTrack: 0,
      reasons: { missingSource: 0, noMatch: 0, upstreamFailure: 0, titleOnly: 0 },
      unknown: 0,
      checkedAt: null,
    })
  })

  it('counts artists no Audition run has checked as unknown, never as missing', async () => {
    await pending(1, 2)
    const digest = await playlist(ownerId, 'weekly_digest')
    await run(ownerId, digest, '2026-10-01', [outcome(1, 'unmatched')])

    const summary = await getPendingPlayability(db, ownerId)
    expect(summary).toMatchObject({ pendingArtists: 2, withoutTrack: 0, unknown: 2 })
    expect(summary.checkedAt).toBeNull()
  })

  it('classifies the newest owned Audition outcome per pending artist', async () => {
    await pending(1, 2, 3, 4, 5, 6, 7)
    const audition = await playlist(ownerId, 'audition')
    const foreign = await playlist(otherId, 'audition')
    // Older run without credentials: no source was configured for anyone.
    await run(ownerId, audition, '2026-10-01', [
      outcome(1, 'unavailable'),
      outcome(2, 'unavailable'),
    ])
    await run(ownerId, audition, '2026-10-02', [
      outcome(2, 'unmatched'),
      outcome(3, 'error'),
      outcome(4, 'resolved'),
      outcome(5, 'limited'),
      outcome(7, 'resolved', true),
      outcome(99, 'unmatched'),
    ])
    await run(otherId, foreign, '2026-10-03', [outcome(6, 'unmatched')])

    expect(await getPendingPlayability(db, ownerId)).toEqual({
      pendingArtists: 7,
      withTrack: 2,
      withoutTrack: 4,
      reasons: { missingSource: 1, noMatch: 1, upstreamFailure: 1, titleOnly: 1 },
      unknown: 1,
      checkedAt: new Date('2026-10-02').toISOString(),
    })
  })
})
