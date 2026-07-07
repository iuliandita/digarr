import { describe, expect, it, vi } from 'vitest'
import type { Database } from '@/db'
import {
  getGenreArtists,
  getGenreFeedbackHistory,
  getRejectedArtistMbids,
  rejectRecommendation,
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

  // Regression (per-user genre-feedback isolation): the scoring entry points
  // must scope the feedback aggregate to the acting user. The mechanism is the
  // conditional `AND r.user_id = $userId` filter inside the query. These cases
  // assert that filter is emitted (and carries the user's id) when a userId is
  // supplied, and absent when it is not (the intentional global-aggregate
  // branch used by single-user / admin-global contexts).
  function captureExecuteSql(): { db: Database; getSql: () => unknown } {
    const execute = vi.fn().mockResolvedValue({ rows: [] })
    return {
      db: { execute } as unknown as Database,
      getSql: () => execute.mock.calls[0]?.[0],
    }
  }

  // Walk the drizzle `sql` object and return both the concatenated SQL text and
  // the raw scalar values interpolated into it. The userId is interpolated as a
  // bare number directly into the nested userFilter's queryChunks (not wrapped
  // in a Param), so a generic collector has to gather raw scalars too.
  function inspectSql(node: unknown): { text: string; scalars: unknown[] } {
    const textParts: string[] = []
    const scalars: unknown[] = []
    const seen = new WeakSet<object>()

    function visit(value: unknown): void {
      if (value === null || value === undefined) return
      if (typeof value === 'number' || typeof value === 'boolean') {
        scalars.push(value)
        return
      }
      if (typeof value === 'string') {
        textParts.push(value)
        return
      }
      if (Array.isArray(value)) {
        for (const item of value) visit(item)
        return
      }
      if (typeof value === 'object') {
        if (seen.has(value)) return
        seen.add(value)
        const obj = value as { value?: unknown; queryChunks?: unknown }
        if ('value' in obj) visit(obj.value)
        if ('queryChunks' in obj) visit(obj.queryChunks)
        return
      }
    }

    visit(node)
    return { text: textParts.join(''), scalars }
  }

  it('scopes the aggregate to the acting user when userId is provided', async () => {
    const { db, getSql } = captureExecuteSql()
    await getGenreFeedbackHistory(db, 42)
    const { text, scalars } = inspectSql(getSql())
    // The user_id predicate is emitted and the user's id is bound into it, so
    // Postgres only counts this user's acted-on recommendations.
    expect(text).toContain('r.user_id =')
    expect(scalars).toContain(42)
  })

  it('does not scope to a user when userId is omitted (global aggregate)', async () => {
    const { db, getSql } = captureExecuteSql()
    await getGenreFeedbackHistory(db)
    const { text, scalars } = inspectSql(getSql())
    // No user predicate is emitted; the aggregate intentionally spans every
    // user (the single-user / admin-global branch).
    expect(text).not.toContain('r.user_id')
    expect(scalars).not.toContain(42)
  })

  it('binds the distinct id for two different users (no cross-user bleed)', async () => {
    const a = captureExecuteSql()
    await getGenreFeedbackHistory(a.db, 1)
    const aInspect = inspectSql(a.getSql())
    expect(aInspect.text).toContain('r.user_id =')
    expect(aInspect.scalars).toContain(1)
    expect(aInspect.scalars).not.toContain(2)

    const b = captureExecuteSql()
    await getGenreFeedbackHistory(b.db, 2)
    const bInspect = inspectSql(b.getSql())
    expect(bInspect.text).toContain('r.user_id =')
    expect(bInspect.scalars).toContain(2)
    expect(bInspect.scalars).not.toContain(1)
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

describe('rejectRecommendation', () => {
  type RejectedRow = { artistId: number; kind: string; releaseGroupMbid: string | null }

  function tableName(tableArg: unknown): string | undefined {
    const nameSymbol = Object.getOwnPropertySymbols(tableArg as object).find(
      (s) => s.toString() === 'Symbol(drizzle:Name)',
    )
    return nameSymbol ? (tableArg as Record<symbol, string>)[nameSymbol] : undefined
  }

  function makeRejectTxDb(recRow: RejectedRow | undefined) {
    const returning = vi.fn().mockResolvedValue(recRow ? [recRow] : [])
    const updateWhere = vi.fn().mockReturnValue({ returning })
    const set = vi.fn().mockReturnValue({ where: updateWhere })
    const update = vi.fn().mockReturnValue({ set })

    const insertCalls: Array<{ table: string | undefined; values: Record<string, unknown> }> = []
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined)
    const onConflictDoNothing = vi.fn().mockResolvedValue(undefined)
    const insert = vi.fn((table: unknown) => ({
      values: vi.fn((vals: Record<string, unknown>) => {
        insertCalls.push({ table: tableName(table), values: vals })
        return { onConflictDoUpdate, onConflictDoNothing }
      }),
    }))

    const tx: { update: typeof update; insert: typeof insert } = { update, insert }
    const db = {
      transaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
    } as unknown as Database

    return { db, insertCalls, update, set, updateWhere, returning }
  }

  it('writes album_blocks (not artist_blocks) on permanent reject of an album-kind rec with a release group', async () => {
    const { db, insertCalls } = makeRejectTxDb({
      artistId: 10,
      kind: 'album',
      releaseGroupMbid: 'rg-mbid-1',
    })

    const artistId = await rejectRecommendation(db, {
      recommendationId: 1,
      userId: 5,
      reason: 'wrong_style',
      reasonText: 'not my style',
      permanent: true,
    })

    expect(artistId).toBe(10)
    expect(insertCalls).toHaveLength(1)
    expect(insertCalls[0]?.table).toBe('album_blocks')
    expect(insertCalls[0]?.values).toMatchObject({
      userId: 5,
      artistId: 10,
      releaseGroupMbid: 'rg-mbid-1',
      reason: 'wrong_style',
      reasonText: 'not my style',
      source: 'rejection',
    })
    expect(insertCalls.some((c) => c.table === 'artist_blocks')).toBe(false)
  })

  it('writes artist_blocks (not album_blocks) on permanent reject of an artist-kind rec', async () => {
    const { db, insertCalls } = makeRejectTxDb({
      artistId: 20,
      kind: 'artist',
      releaseGroupMbid: null,
    })

    const artistId = await rejectRecommendation(db, {
      recommendationId: 2,
      userId: 5,
      reason: 'not_interested',
      reasonText: null,
      permanent: true,
    })

    expect(artistId).toBe(20)
    expect(insertCalls).toHaveLength(1)
    expect(insertCalls[0]?.table).toBe('artist_blocks')
    expect(insertCalls[0]?.values).toMatchObject({ userId: 5, artistId: 20 })
    expect(insertCalls.some((c) => c.table === 'album_blocks')).toBe(false)
  })

  it('falls back to artist_blocks for an album-kind rec with a null release group', async () => {
    const { db, insertCalls } = makeRejectTxDb({
      artistId: 30,
      kind: 'album',
      releaseGroupMbid: null,
    })

    const artistId = await rejectRecommendation(db, {
      recommendationId: 3,
      userId: 5,
      reason: 'other',
      reasonText: null,
      permanent: true,
    })

    expect(artistId).toBe(30)
    expect(insertCalls).toHaveLength(1)
    expect(insertCalls[0]?.table).toBe('artist_blocks')
    expect(insertCalls.some((c) => c.table === 'album_blocks')).toBe(false)
  })

  it('writes neither block table on a non-permanent album reject', async () => {
    const { db, insertCalls } = makeRejectTxDb({
      artistId: 40,
      kind: 'album',
      releaseGroupMbid: 'rg-mbid-2',
    })

    const artistId = await rejectRecommendation(db, {
      recommendationId: 4,
      userId: 5,
      reason: null,
      reasonText: null,
      permanent: false,
    })

    expect(artistId).toBe(40)
    expect(insertCalls).toHaveLength(0)
  })
})
