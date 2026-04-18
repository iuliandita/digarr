import { describe, expect, it, vi } from 'vitest'
import type { Database } from '@/db'
import {
  getGenreArtists,
  getGenreFeedbackHistory,
  getRejectedArtistMbids,
} from '@/db/queries/recommendations'

// Build a mock drizzle db that returns a fixed result when awaited.
// The query chain: db.select({...}).from(...).innerJoin(...).where(...) -> rows
function makeMockDb(rows: unknown[]): Database {
  const chain = {
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(rows),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
  }
  return {
    select: vi.fn().mockReturnValue(chain),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(),
    execute: vi.fn(),
  } as unknown as Database
}

function collectParamValues(node: unknown): unknown[] {
  const values: unknown[] = []

  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }

    if (!value || typeof value !== 'object') return

    const param = value as { value?: unknown; queryChunks?: unknown[] }
    if ('value' in param) values.push(param.value)
    if (Array.isArray(param.queryChunks)) visit(param.queryChunks)
  }

  visit(node)
  return values
}

// Aggregation moved into SQL (unnest + GROUP BY), so the unit tests now mock
// pre-aggregated execute() rows. The SQL correctness is covered by the
// integration tests that run against Postgres.
function makeExecuteMock(rows: unknown[]): Database {
  return {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(),
    execute: vi.fn().mockResolvedValue({ rows }),
  } as unknown as Database
}

describe('getGenreFeedbackHistory', () => {
  it('returns correct approved/total counts per genre', async () => {
    const db = makeExecuteMock([
      { genre: 'rock', total: 2, approved: 1 },
      { genre: 'metal', total: 2, approved: 2 },
      { genre: 'jazz', total: 1, approved: 1 },
    ])

    const result = await getGenreFeedbackHistory(db)

    expect(result.get('rock')).toEqual({ approved: 1, total: 2 })
    expect(result.get('metal')).toEqual({ approved: 2, total: 2 })
    expect(result.get('jazz')).toEqual({ approved: 1, total: 1 })
  })

  it('returns empty map when no acted-upon recommendations', async () => {
    const db = makeExecuteMock([])
    const result = await getGenreFeedbackHistory(db)
    expect(result.size).toBe(0)
  })
})

describe('getRejectedArtistMbids', () => {
  it('returns a Set of MBIDs from the query result', async () => {
    const rows = [{ mbid: 'mbid-1' }, { mbid: 'mbid-2' }, { mbid: 'mbid-3' }]
    const db = makeMockDb(rows)

    const result = await getRejectedArtistMbids(db, 90)

    expect(result).toBeInstanceOf(Set)
    expect(result.size).toBe(3)
    expect(result.has('mbid-1')).toBe(true)
    expect(result.has('mbid-2')).toBe(true)
    expect(result.has('mbid-3')).toBe(true)
  })

  it('returns empty Set when no rejected artists in cooldown window', async () => {
    const db = makeMockDb([])
    const result = await getRejectedArtistMbids(db, 90)
    expect(result.size).toBe(0)
  })

  it('passes cutoff date based on cooldownDays', async () => {
    // Verify the query is built with a where clause (the chain is called correctly)
    const rows: unknown[] = []
    const chain = {
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(rows),
    }
    const db = {
      select: vi.fn().mockReturnValue(chain),
    } as unknown as Database

    await getRejectedArtistMbids(db, 30)

    expect(chain.where).toHaveBeenCalledOnce()
  })
})

describe('getGenreArtists', () => {
  it('keeps added_to_lidarr artists out of the recommended tab filter', async () => {
    const rows: unknown[] = []
    const chain = {
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(rows),
    }
    const db = {
      select: vi.fn().mockReturnValue(chain),
    } as unknown as Database

    await getGenreArtists(db, 'trip-hop', 'recommended', 20, 1)

    expect(chain.where).toHaveBeenCalledOnce()

    const whereClause = chain.where.mock.calls[0]?.[0]
    const params = collectParamValues(whereClause)

    expect(params).toContain('approved')
    expect(params).not.toContain('added_to_lidarr')
  })
})
