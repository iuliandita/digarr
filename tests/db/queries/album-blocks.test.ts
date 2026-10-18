import { describe, expect, it, vi } from 'vitest'
import type { Database } from '@/db'
import { createAlbumBlock, getBlockedAlbumKeys } from '@/db/queries/album-blocks'

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
  const onConflictDoNothing = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) })
  const values = vi.fn().mockReturnValue({ onConflictDoNothing })
  const insert = vi.fn().mockReturnValue({ values })
  return {
    db: { insert } as unknown as Database,
    values,
  }
}

describe('createAlbumBlock', () => {
  it('inserts with defaulted albumTitle and source', async () => {
    const { db, values } = makeInsertDb()
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
      albumTitle: null,
      reason: 'already_own',
      reasonText: 'I have it on vinyl',
      source: 'rejection',
    })
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
})
