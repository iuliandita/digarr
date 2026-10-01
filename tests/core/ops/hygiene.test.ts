// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { describe, expect, it, vi } from 'vitest'
import {
  aiReasoningAudit,
  clearImageFailures,
  dedupeRepair,
  purgeSessions,
  rebuildGenres,
  rescoreRecommendations,
} from '@/core/ops/hygiene'

function makeUpdateDb(rowCount: number) {
  return {
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue({ rowCount }),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue({ rowCount }),
    }),
  }
}

describe('clearImageFailures', () => {
  it('resets imageFailedAt on all artists', async () => {
    const db = makeUpdateDb(42)
    const result = await clearImageFailures(db as never)
    expect(result).toEqual({ tool: 'clear-image-failures', cleared: 42 })
  })
})

describe('purgeSessions', () => {
  it('deletes expired sessions', async () => {
    const db = makeUpdateDb(89)
    const result = await purgeSessions(db as never)
    expect(result).toEqual({ tool: 'purge-sessions', purged: 89 })
  })
})

describe('dedupeRepair', () => {
  it('finds and removes duplicate recommendations', async () => {
    const dupeRows = [
      { userId: 1, artistId: 10, id: 100, score: 0.8, sources: { lb: 0.9 }, batchId: 1 },
      { userId: 1, artistId: 10, id: 101, score: 0.6, sources: { sp: 0.7 }, batchId: 2 },
    ]

    const selectChain = {
      from: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockReturnThis(),
      having: vi.fn().mockResolvedValue([{ userId: 1, artistId: 10, cnt: 2 }]),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue(dupeRows),
    }

    const db = {
      select: vi.fn().mockReturnValue(selectChain),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue({ rowCount: 1 }),
        }),
      }),
    }

    const result = await dedupeRepair(db as never)
    expect(result.tool).toBe('dedupe')
    expect(result).toHaveProperty('duplicateGroups')
    expect(result).toHaveProperty('removed')
  })
})

describe('rebuildGenres', () => {
  it('rebuilds genre table from artist data', async () => {
    const artistRows = [
      { tags: ['rock', 'indie'], genres: ['rock', 'alternative'] },
      { tags: ['rock', 'metal'], genres: ['metal'] },
    ]

    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockResolvedValue(artistRows),
      }),
      delete: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(undefined),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    }

    const result = await rebuildGenres(db as never)
    expect(result.tool).toBe('rebuild-genres')
    expect(result).toHaveProperty('genres')
  })
})

describe('rescoreRecommendations', () => {
  const weights = {
    consensus: 0.3,
    similarity: 0.25,
    genreOverlap: 0.2,
    aiConfidence: 0.15,
    feedbackBoost: 0.1,
    popularity: 0,
  }
  const components = {
    consensus: 0.25,
    similarity: 0.7,
    genreOverlap: 1,
    aiConfidence: 0.5,
    feedbackBoost: 0.5,
    popularity: 0.9,
  }

  async function fixture() {
    const client = new PGlite()
    await client.exec(`CREATE TABLE recommendations (
      id integer PRIMARY KEY, user_id integer, score real,
      sources jsonb, kind text, status text
    )`)
    const db = drizzle(client)
    async function insert(
      id: number,
      userId: number,
      sources: unknown,
      kind = 'artist',
      status = 'pending',
    ) {
      await client.query('INSERT INTO recommendations VALUES ($1,$2,$3,$4,$5,$6)', [
        id,
        userId,
        0.1,
        JSON.stringify(sources),
        kind,
        status,
      ])
    }
    return { client, db, insert }
  }

  it('reuses component evidence and album modifiers without touching other users or statuses', async () => {
    const { client, db, insert } = await fixture()
    try {
      await insert(1, 1, components)
      await insert(2, 1, { ...components, recency: 1 }, 'album')
      await insert(3, 2, components)
      await insert(4, 1, components, 'artist', 'approved')
      const result = await rescoreRecommendations(db as never, 1, weights)
      expect(result).toMatchObject({ rescored: 2, skipped: 0 })
      const rows = await client.query<{ id: number; score: number; sources: unknown }>(
        'SELECT id,score,sources FROM recommendations ORDER BY id',
      )
      expect(rows.rows[0]?.score).toBeCloseTo(0.575)
      expect(rows.rows[1]?.score).toBeCloseTo(0.71)
      expect(rows.rows[2]?.score).toBeCloseTo(0.1)
      expect(rows.rows[3]?.score).toBeCloseTo(0.1)
      expect(rows.rows[0]?.sources).toEqual(components)
    } finally {
      await client.close()
    }
  })

  it('skips incompatible or invalid evidence and retains legacy zero popularity', async () => {
    const { client, db, insert } = await fixture()
    try {
      const { popularity: _, ...legacy } = components
      await insert(1, 1, legacy)
      await insert(2, 1, { listenbrainz: 0.8 })
      await insert(3, 1, { ...components, feedbackBoost: 2 })
      await insert(4, 1, { ...components, recency: '1' }, 'album')
      await insert(5, 1, components, 'unknown')
      const result = await rescoreRecommendations(db as never, 1, weights)
      expect(result).toMatchObject({ rescored: 1, skippedInvalid: 4, skipped: 4 })
      const rows = await client.query<{ id: number; score: number }>(
        'SELECT id,score FROM recommendations ORDER BY id',
      )
      expect(rows.rows[0]?.score).toBeCloseTo(0.575)
      expect(rows.rows.slice(1).every((row) => Math.abs(row.score - 0.1) < 0.00001)).toBe(true)
    } finally {
      await client.close()
    }
  })

  it('skips rows whose action or score evidence changes after selection', async () => {
    const { client, db, insert } = await fixture()
    try {
      await insert(1, 1, components)
      await insert(2, 1, components)
      await insert(3, 1, components)
      const execute = db.execute.bind(db)
      const raceDb = {
        select: db.select.bind(db),
        execute: async (query: Parameters<typeof db.execute>[0]) => {
          await client.exec(
            "UPDATE recommendations SET status='approved' WHERE id=1; UPDATE recommendations SET score=0.9 WHERE id=2; UPDATE recommendations SET sources='{}' WHERE id=3",
          )
          return execute(query)
        },
      }
      const result = await rescoreRecommendations(raceDb as never, 1, weights, [
        'pending',
        'approved',
      ])
      expect(result).toMatchObject({ rescored: 0, skippedConcurrent: 3, skipped: 3 })
      const rows = await client.query<{ id: number; score: number; status: string }>(
        'SELECT id,score,status FROM recommendations ORDER BY id',
      )
      expect(rows.rows[0]?.status).toBe('approved')
      expect(rows.rows[0]?.score).toBeCloseTo(0.1)
      expect(rows.rows[1]?.score).toBeCloseTo(0.9)
      expect(rows.rows[2]?.score).toBeCloseTo(0.1)
    } finally {
      await client.close()
    }
  })
})
describe('aiReasoningAudit', () => {
  it('flags recommendations where name is missing and genres dont overlap', async () => {
    const recRows = [
      {
        recId: 1,
        aiReasoning: 'A great jazz musician with smooth vocals',
        artistName: 'Metallica',
        artistTags: ['metal', 'thrash'],
        artistGenres: ['heavy metal'],
      },
      {
        recId: 2,
        aiReasoning: 'Radiohead is an innovative rock band',
        artistName: 'Radiohead',
        artistTags: ['alternative', 'rock'],
        artistGenres: ['alternative rock'],
      },
    ]

    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(recRows),
          }),
        }),
      }),
    }

    const result = await aiReasoningAudit(db as never)
    expect(result.flagged).toBe(1)
    expect(result.flaggedIds).toContain(1)
    expect(result.flaggedIds).not.toContain(2)
  })

  it('does not flag when name appears in reasoning', async () => {
    const recRows = [
      {
        recId: 1,
        aiReasoning: 'Metallica brings heavy riffs and energy',
        artistName: 'Metallica',
        artistTags: ['pop'],
        artistGenres: ['pop'],
      },
    ]

    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(recRows),
          }),
        }),
      }),
    }

    const result = await aiReasoningAudit(db as never)
    expect(result.flagged).toBe(0)
  })
})
