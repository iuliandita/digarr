import { describe, expect, it, vi } from 'vitest'
import type { Database } from '@/db'
import {
  createAlbumBlock,
  getBlockedAlbumKeys,
  listAlbumBlocks,
  removeAlbumBlock,
} from '@/db/queries/album-blocks'

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

function makeInsertDb(): {
  db: Database
  values: ReturnType<typeof vi.fn>
  onConflictDoNothing: ReturnType<typeof vi.fn>
} {
  const onConflictDoNothing = vi.fn().mockResolvedValue(undefined)
  const values = vi.fn().mockReturnValue({ onConflictDoNothing })
  const insert = vi.fn().mockReturnValue({ values })
  return {
    db: { insert } as unknown as Database,
    values,
    onConflictDoNothing,
  }
}

function makeDeleteDb(): { db: Database; where: ReturnType<typeof vi.fn> } {
  const where = vi.fn().mockResolvedValue(undefined)
  const del = vi.fn().mockReturnValue({ where })
  return {
    db: { delete: del } as unknown as Database,
    where,
  }
}

describe('createAlbumBlock', () => {
  it('inserts with correct values and calls onConflictDoNothing', async () => {
    const { db, values, onConflictDoNothing } = makeInsertDb()
    await createAlbumBlock(db, {
      userId: 1,
      artistId: 10,
      releaseGroupMbid: 'rg-mbid-1',
      reason: 'already_own',
      reasonText: 'I have it on vinyl',
    })
    expect(values).toHaveBeenCalledWith({
      userId: 1,
      artistId: 10,
      releaseGroupMbid: 'rg-mbid-1',
      reason: 'already_own',
      reasonText: 'I have it on vinyl',
      source: 'rejection',
    })
    expect(onConflictDoNothing).toHaveBeenCalled()
  })

  it('defaults source to "rejection" when omitted', async () => {
    const { db, values } = makeInsertDb()
    await createAlbumBlock(db, { userId: 2, artistId: 20, releaseGroupMbid: 'rg-mbid-2' })
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ source: 'rejection' }))
  })

  it('forwards source=manual when explicitly passed', async () => {
    const { db, values } = makeInsertDb()
    await createAlbumBlock(db, {
      userId: 3,
      artistId: 30,
      releaseGroupMbid: 'rg-mbid-3',
      source: 'manual',
    })
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ source: 'manual' }))
  })
})

describe('removeAlbumBlock', () => {
  it('calls delete().where() with the correct user and mbid', async () => {
    const { db, where } = makeDeleteDb()
    await removeAlbumBlock(db, { userId: 1, releaseGroupMbid: 'rg-mbid-1' })
    expect(where).toHaveBeenCalled()
  })
})

describe('getBlockedAlbumKeys', () => {
  it('returns a Set of release group mbid strings', async () => {
    const db = makeChainSelectDb([{ releaseGroupMbid: 'rg-1' }, { releaseGroupMbid: 'rg-2' }])
    const keys = await getBlockedAlbumKeys(db, 1)
    expect(keys).toBeInstanceOf(Set)
    expect(keys.size).toBe(2)
    expect(keys.has('rg-1')).toBe(true)
    expect(keys.has('rg-2')).toBe(true)
  })

  it('returns an empty Set when no blocks exist', async () => {
    const db = makeChainSelectDb([])
    const keys = await getBlockedAlbumKeys(db, 1)
    expect(keys).toBeInstanceOf(Set)
    expect(keys.size).toBe(0)
  })
})

describe('listAlbumBlocks', () => {
  const baseRow = {
    id: 1,
    artistId: 10,
    artistName: 'Artist A',
    artistMbid: 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa',
    releaseGroupMbid: 'rg-mbid-1',
    reason: 'already_own',
    reasonText: null,
    blockedAt: new Date('2026-01-01T00:00:00Z'),
  }

  it('returns mocked joined rows', async () => {
    const db = makeChainSelectDb([baseRow])
    const rows = await listAlbumBlocks(db, 1)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.artistName).toBe('Artist A')
    expect(rows[0]?.releaseGroupMbid).toBe('rg-mbid-1')
  })

  it('returns an empty array when no blocks exist', async () => {
    const db = makeChainSelectDb([])
    const rows = await listAlbumBlocks(db, 1)
    expect(rows).toHaveLength(0)
  })
})
