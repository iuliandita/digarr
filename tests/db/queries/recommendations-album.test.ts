import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '@/db'
import {
  getExistingAlbumReleaseGroupMbids,
  insertRecommendation,
} from '@/db/queries/recommendations'

const { mockedEq, mockedAnd, mockedOr, mockedIsNull } = vi.hoisted(() => ({
  mockedEq: vi.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right })),
  mockedAnd: vi.fn((...clauses: unknown[]) => ({ op: 'and', clauses })),
  mockedOr: vi.fn((...clauses: unknown[]) => ({ op: 'or', clauses })),
  mockedIsNull: vi.fn((col: unknown) => ({ op: 'isNull', col })),
}))

vi.mock('drizzle-orm', async (importOriginal) => {
  const original = await importOriginal<typeof import('drizzle-orm')>()
  return { ...original, eq: mockedEq, and: mockedAnd, or: mockedOr, isNull: mockedIsNull }
})

beforeEach(() => {
  mockedEq.mockClear()
  mockedAnd.mockClear()
  mockedOr.mockClear()
  mockedIsNull.mockClear()
})

function makeChainSelectDb(rows: unknown[]): Database {
  const chain: Record<string, unknown> = {}
  chain.from = vi.fn().mockReturnValue(chain)
  chain.innerJoin = vi.fn().mockReturnValue(chain)
  chain.where = vi.fn().mockReturnValue(chain)
  chain.orderBy = vi.fn().mockReturnValue(chain)
  chain.limit = vi.fn().mockResolvedValue(rows)
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock so the chain resolves whether or not the caller calls .limit()
  chain.then = (resolve: (value: unknown) => void) => resolve(rows)
  return {
    select: vi.fn().mockReturnValue(chain),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(),
    execute: vi.fn(),
  } as unknown as Database
}

function makeInsertDb(): { db: Database; values: ReturnType<typeof vi.fn> } {
  const values = vi.fn().mockResolvedValue(undefined)
  const insert = vi.fn().mockReturnValue({ values })
  return {
    db: { insert } as unknown as Database,
    values,
  }
}

describe('insertRecommendation', () => {
  const baseData = {
    artistId: 1,
    batchId: 2,
    score: 0.9,
    sources: { mb: 0.9 },
    status: 'pending',
  }

  it('defaults kind to "artist" when omitted', async () => {
    const { db, values } = makeInsertDb()
    await insertRecommendation(db, baseData)
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ kind: 'artist' }))
  })

  it('passes kind="album" through when given', async () => {
    const { db, values } = makeInsertDb()
    await insertRecommendation(db, { ...baseData, kind: 'album' })
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ kind: 'album' }))
  })

  it('passes kind="artist" through when explicitly given', async () => {
    const { db, values } = makeInsertDb()
    await insertRecommendation(db, { ...baseData, kind: 'artist' })
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ kind: 'artist' }))
  })
})

describe('getExistingAlbumReleaseGroupMbids', () => {
  it('returns a Set with non-null rg values, filtering out nulls', async () => {
    const db = makeChainSelectDb([{ rg: 'rg-1' }, { rg: null }, { rg: 'rg-2' }])
    const result = await getExistingAlbumReleaseGroupMbids(db)
    expect(result).toBeInstanceOf(Set)
    expect(result.size).toBe(2)
    expect(result.has('rg-1')).toBe(true)
    expect(result.has('rg-2')).toBe(true)
  })

  it('applies the kind="album" filter', async () => {
    const db = makeChainSelectDb([{ rg: 'rg-1' }])
    await getExistingAlbumReleaseGroupMbids(db)
    // eq(recommendations.kind, 'album') must be called; dropping this filter
    // would cause the dedup to bleed artist-kind recs into the set
    expect(mockedEq).toHaveBeenCalledWith(expect.anything(), 'album')
  })

  it('returns an empty Set when no album recs exist', async () => {
    const db = makeChainSelectDb([])
    const result = await getExistingAlbumReleaseGroupMbids(db)
    expect(result).toBeInstanceOf(Set)
    expect(result.size).toBe(0)
  })

  it('returns an empty Set when all rg values are null', async () => {
    const db = makeChainSelectDb([{ rg: null }, { rg: null }])
    const result = await getExistingAlbumReleaseGroupMbids(db)
    expect(result.size).toBe(0)
  })

  it('scopes to userId when provided', async () => {
    const db = makeChainSelectDb([{ rg: 'rg-3' }])
    const result = await getExistingAlbumReleaseGroupMbids(db, 42)
    expect(result.has('rg-3')).toBe(true)
    // Must filter by userId=42 via eq() and also include null-user recs via isNull()
    expect(mockedEq).toHaveBeenCalledWith(expect.anything(), 42)
    expect(mockedIsNull).toHaveBeenCalled()
    // or() must combine the userId and null-userId conditions
    expect(mockedOr).toHaveBeenCalled()
  })
})
