import { describe, expect, it, vi } from 'vitest'
import type { Database } from '@/db'
import { addBlock, getBlockedMbids, listBlocks, removeBlock } from '@/db/queries/artist-blocks'

function makeChainSelectDb(rows: unknown[]): Database {
  // The chain is thenable from any of `.where()`, `.orderBy()`, or `.limit()`
  // so a query that doesn't call `.limit()` (e.g. getBlockedMbids) still resolves.
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
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined)
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate })
  const insert = vi.fn().mockReturnValue({ values })
  return {
    db: { insert } as unknown as Database,
    values,
  }
}

function makeDeleteDb(returned: unknown[]): { db: Database; where: ReturnType<typeof vi.fn> } {
  const returning = vi.fn().mockResolvedValue(returned)
  const where = vi.fn().mockReturnValue({ returning })
  const del = vi.fn().mockReturnValue({ where })
  return {
    db: { delete: del } as unknown as Database,
    where,
  }
}

describe('addBlock', () => {
  it('inserts with reason + reasonText + source defaulting to rejection', async () => {
    const { db, values } = makeInsertDb()
    await addBlock(db, { userId: 1, artistId: 10, reason: 'already_own' })
    expect(values).toHaveBeenCalledWith({
      userId: 1,
      artistId: 10,
      reason: 'already_own',
      reasonText: null,
      source: 'rejection',
    })
  })

  it('forwards source=manual when explicitly passed', async () => {
    const { db, values } = makeInsertDb()
    await addBlock(db, { userId: 2, artistId: 20, source: 'manual' })
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ source: 'manual' }))
  })
})

describe('removeBlock', () => {
  it('returns true when a row was deleted', async () => {
    const { db } = makeDeleteDb([{ id: 1 }])
    expect(await removeBlock(db, { userId: 1, artistId: 10 })).toBe(true)
  })

  it('returns false when no rows matched', async () => {
    const { db } = makeDeleteDb([])
    expect(await removeBlock(db, { userId: 1, artistId: 10 })).toBe(false)
  })
})

describe('listBlocks', () => {
  const baseRow = {
    id: 1,
    artistId: 10,
    name: 'Artist A',
    mbid: 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa',
    reason: 'already_own',
    reasonText: null,
    blockedAt: new Date('2026-01-01T00:00:00Z'),
  }

  it('returns items and null cursor when fewer than limit returned', async () => {
    const db = makeChainSelectDb([baseRow])
    const r = await listBlocks(db, { userId: 1, limit: 50 })
    expect(r.items).toHaveLength(1)
    expect(r.items[0]?.name).toBe('Artist A')
    expect(r.nextCursor).toBeNull()
  })

  it('returns nextCursor when limit + 1 rows returned', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      ...baseRow,
      id: i + 1,
      blockedAt: new Date(2026, 0, i + 1),
    }))
    const db = makeChainSelectDb(rows)
    const r = await listBlocks(db, { userId: 1, limit: 2 })
    expect(r.items).toHaveLength(2)
    expect(r.nextCursor).not.toBeNull()
    expect(r.nextCursor?.id).toBe(2)
  })

  it('clamps limit into [1, 200]', async () => {
    const db = makeChainSelectDb([])
    await listBlocks(db, { userId: 1, limit: 99999 })
    // first call to .limit() is +1 over the requested limit; we requested 200 max
    const selectMock = db.select as unknown as ReturnType<typeof vi.fn>
    const chain = selectMock.mock.results[0]?.value as { limit: ReturnType<typeof vi.fn> }
    expect(chain.limit).toHaveBeenCalledWith(201)
  })
})

describe('getBlockedMbids', () => {
  it('returns a Set of MBID strings', async () => {
    const db = makeChainSelectDb([
      { mbid: 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa' },
      { mbid: 'bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb' },
    ])
    const mbids = await getBlockedMbids(db, 1)
    expect(mbids.size).toBe(2)
    expect(mbids.has('aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa')).toBe(true)
  })

  it('skips null mbids defensively', async () => {
    const db = makeChainSelectDb([{ mbid: null }, { mbid: 'cccccccc-3333-3333-3333-cccccccccccc' }])
    const mbids = await getBlockedMbids(db, 1)
    expect(mbids.size).toBe(1)
  })
})
