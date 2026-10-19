// @vitest-environment node
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createLibrarySyncStore } from '@/core/library/store'
import type { Database } from '@/db'
import { getGenreEnrichments } from '@/db/queries/artists'
import { getJobById, listJobs } from '@/db/queries/jobs'
import { artists, genres, jobRuns, libraryAlbums, users } from '@/db/schema'
import { makeTestDb } from '../../helpers/test-db'

describe('query scaling on migrated PGlite', () => {
  let db: Database
  let close: () => Promise<void>
  beforeAll(async () => {
    const result = await makeTestDb()
    db = result.db as unknown as Database
    close = result.close
  })
  afterAll(async () => close?.())

  it('keeps the old genre counts and examples, including repeated tags and tied names', async () => {
    await db.insert(genres).values([
      { name: 'Rock', slug: 'rock', source: 'library' },
      { name: 'ROCK', slug: 'upper-rock', source: 'rebuild' },
      { name: 'Rock', slug: 'duplicate-rock', source: 'rebuild' },
      { name: 'Jazz', slug: 'jazz', source: 'library' },
      { name: 'Missing', slug: 'missing', source: 'library' },
      { name: 'Other', slug: 'other', source: 'external' },
    ])
    await db.insert(artists).values(
      [
        ['Same', ['Rock', 'rock', 'ROCK', 'Jazz']],
        ['Same', ['rOcK', 'JAZZ', 'jazz']],
        ['Alpha', ['rock']],
        ['Zulu', ['rock', 'Other']],
        ['Empty', []],
        ['Null', null],
      ].map(([name, tags], index) => ({
        mbid: `00000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`,
        name: name as string,
        genres: tags as string[] | null,
      })),
    )
    for (const limit of [0, 3]) {
      const old = await db.execute<{ name: string; cnt: number; examples: string[] }>(sql`
        SELECT g.name, count(*)::integer AS cnt,
          (SELECT coalesce(array_agg(ex.name), ARRAY[]::text[]) FROM (
            SELECT sub.name FROM genres g2 CROSS JOIN LATERAL (
              SELECT ar.name FROM artists ar WHERE EXISTS (
                SELECT 1 FROM unnest(ar.genres) tag WHERE lower(tag) = lower(g2.name)
              ) ORDER BY ar.name LIMIT ${limit}
            ) sub WHERE g2.name = g.name AND g2.source IN ('library', 'rebuild')
          ) ex) AS examples
        FROM genres g JOIN artists ar ON EXISTS (
          SELECT 1 FROM unnest(ar.genres) tag WHERE lower(tag) = lower(g.name)
        ) WHERE g.source IN ('library', 'rebuild') GROUP BY g.name
      `)
      expect(await getGenreEnrichments(db, limit)).toEqual(
        new Map(old.rows.map((row) => [row.name, { liveCount: row.cnt, examples: row.examples }])),
      )
    }
  })

  it('pages only visible unresolved rows and measures a 10,000-album first page', async () => {
    const [owner, other] = await db
      .insert(users)
      .values([
        { username: 'review-owner', passwordHash: 'hash' },
        { username: 'review-other', passwordHash: 'hash' },
      ])
      .returning({ id: users.id })
    if (!owner || !other) throw new Error('Missing fixture users')
    await db.execute(sql`INSERT INTO library_albums
      (user_id, source, source_album_id, source_artist_id, title, title_normalized, unreconciled_reason)
      SELECT ${owner.id}, 'plex', n::text, 'artist', 'Album ' || n, 'album ' || n, 'no_candidate'
      FROM generate_series(1, 10000) n`)
    const store = createLibrarySyncStore(db)
    const before = { items: await db.select().from(libraryAlbums) }
    const page = await store.listUnreconciledAlbumsForUser(owner.id)
    expect(page.total).toBe(10000)
    expect(page.items).toHaveLength(20)
    expect(Object.keys(page.items[0] ?? {}).sort()).toEqual([
      'id',
      'primaryType',
      'releaseYear',
      'source',
      'sourceAlbumId',
      'title',
      'unreconciledReason',
    ])
    const second = await store.listUnreconciledAlbumsForUser(owner.id, { limit: 20, offset: 20 })
    expect(second.items[0]?.id).toBeGreaterThan(page.items[19]?.id ?? 0)
    expect(await store.listUnreconciledAlbumsForUser(other.id)).toEqual({ items: [], total: 0 })
    await store.upsertAlbumOverride(owner.id, 'plex', '1', null)
    expect((await store.listUnreconciledAlbumsForUser(owner.id)).total).toBe(9999)
    console.info(
      'album response fixture',
      JSON.stringify({
        beforeRows: before.items.length,
        afterRows: page.items.length,
        beforeBytes: Buffer.byteLength(JSON.stringify(before)),
        afterBytes: Buffer.byteLength(JSON.stringify(page)),
      }),
    )

    await db.execute(sql`INSERT INTO library_artists
      (user_id, source, source_artist_id, name, name_normalized)
      VALUES (${owner.id}, 'plex', 'own', 'Own', 'own'),
        (${other.id}, 'plex', 'other', 'Other', 'other'),
        (NULL, 'lidarr', 'global', 'Global', 'global')`)
    await db.execute(sql`INSERT INTO library_albums
      (user_id, source, source_album_id, source_artist_id, title, title_normalized)
      VALUES (NULL, 'lidarr', 'global', 'artist', 'Global', 'global')`)
    expect((await store.listUnreconciledAlbumsForUser(other.id)).total).toBe(1)
    await store.upsertAlbumOverride(other.id, 'lidarr', 'global', null)
    expect((await store.listUnreconciledAlbumsForUser(other.id)).total).toBe(0)
    expect((await store.listUnreconciledAlbumsForUser(owner.id)).total).toBe(10000)
    expect((await store.listUnreconciledForUser(owner.id)).total).toBe(2)
    expect((await store.listUnreconciledForUser(other.id)).total).toBe(2)
    await store.upsertOverride(owner.id, 'lidarr', 'global', null)
    const artistPage = await store.listUnreconciledForUser(owner.id, { limit: 1, offset: 0 })
    expect(artistPage.total).toBe(1)
    expect(artistPage.items[0]?.name).toBe('Own')
    expect(Object.keys(artistPage.items[0] ?? {}).sort()).toEqual([
      'id',
      'name',
      'source',
      'sourceArtistId',
      'unreconciledReason',
    ])
    expect(
      (await store.listUnreconciledForUser(other.id, { limit: 1, offset: 1 })).items[0]?.name,
    ).toBe('Global')
    expect((await store.listUnreconciledForUser(owner.id, { limit: 1, offset: 1 })).items).toEqual(
      [],
    )
  }, 30_000)

  it('projects job summaries, preserves detail, and orders tied starts by descending ID', async () => {
    const metadata = {
      trigger: 'manual' as const,
      artistsDiscovered: 3,
      source: 'plex',
      discoveryMode: { modeId: 'test', settingsMode: 'easy' as const, providerPath: ['test'] },
      playlistResolution: {
        outcomes: Array.from({ length: 1000 }, (_, i) => ({
          artistName: `Artist ${i}`,
          status: 'resolved',
        })),
      },
    }
    const inserted = await db
      .insert(jobRuns)
      .values(
        Array.from({ length: 50 }, () => ({
          type: 'pipeline',
          status: 'completed',
          startedAt: new Date('2026-01-01T00:00:00Z'),
          metadata,
          sourceResults: { test: { status: 'ok', artists: 3, reason: 'detail' } },
        })),
      )
      .returning()
    const page = await listJobs(db, { limit: 50 })
    expect(page.total).toBe(50)
    expect(page.items.map((job) => job.id)).toEqual(inserted.map((job) => job.id).reverse())
    expect(page.items[0]?.metadata).toEqual({
      trigger: 'manual',
      artistsDiscovered: 3,
      source: 'plex',
      discoveryMode: metadata.discoveryMode,
    })
    expect(page.items[0]?.sourceResults).toEqual({ test: { status: 'ok' } })
    const id = page.items[0]?.id ?? 0
    expect((await getJobById(db, id))?.metadata).toEqual(metadata)
    expect((await getJobById(db, id))?.sourceResults?.test?.reason).toBe('detail')
    expect((await listJobs(db, { limit: 1, offset: 1 })).items[0]?.id).toBe(inserted[48]?.id)
    expect(await listJobs(db, { status: 'failed' })).toEqual({ items: [], total: 0 })
    const index = await db.execute<{ indexdef: string }>(
      sql`SELECT indexdef FROM pg_indexes WHERE indexname = 'job_runs_started_at_id_idx'`,
    )
    expect(index.rows[0]?.indexdef).toContain('started_at DESC')
    expect(index.rows[0]?.indexdef).toContain('id DESC')
    console.info(
      'job response fixture',
      JSON.stringify({
        beforeRows: inserted.length,
        afterRows: page.items.length,
        beforeBytes: Buffer.byteLength(JSON.stringify({ items: inserted, total: 50 })),
        afterBytes: Buffer.byteLength(JSON.stringify(page)),
      }),
    )
  }, 30_000)
})
