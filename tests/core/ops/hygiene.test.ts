// @vitest-environment node
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
  it('rescores pending recommendations with new weights', async () => {
    const recRows = [
      {
        recId: 1,
        sources: { listenbrainz: 0.8, lastfm: 0.7 },
        artistGenres: ['rock', 'indie'],
        artistTags: ['rock'],
        artistName: 'Test',
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
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue({ rowCount: 1 }),
        }),
      }),
      execute: vi.fn().mockResolvedValue({ rowCount: 1 }),
    }

    const weights = {
      consensus: 0.3,
      similarity: 0.25,
      genreOverlap: 0.2,
      aiConfidence: 0.15,
      feedbackBoost: 0.1,
      popularity: 0.0,
    }

    const result = await rescoreRecommendations(db as never, weights, ['rock', 'indie'])
    expect(result.tool).toBe('rescore')
    expect(result).toHaveProperty('rescored')
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
