import { describe, expect, it, vi } from 'vitest'
import type { Database } from '@/db'
import { createAlbumBlock } from '@/db/queries/album-blocks'
import { addBlock } from '@/db/queries/artist-blocks'

// Album and artist blocks record why a block exists with the same `source` contract.
function makeInsertDb() {
  const resolved = vi.fn().mockResolvedValue(undefined)
  const values = vi
    .fn()
    .mockReturnValue({ onConflictDoNothing: resolved, onConflictDoUpdate: resolved })
  return { db: { insert: vi.fn().mockReturnValue({ values }) } as unknown as Database, values }
}

describe.each([
  [
    'createAlbumBlock',
    (db: Database, source?: 'manual') =>
      createAlbumBlock(db, { userId: 1, artistId: 10, releaseGroupMbid: 'rg-mbid-1', source }),
  ],
  [
    'addBlock',
    (db: Database, source?: 'manual') => addBlock(db, { userId: 1, artistId: 10, source }),
  ],
])('%s source', (_name, insertBlock) => {
  it('defaults source to "rejection" when omitted', async () => {
    const { db, values } = makeInsertDb()
    await insertBlock(db)
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ source: 'rejection' }))
  })

  it('forwards source=manual when explicitly passed', async () => {
    const { db, values } = makeInsertDb()
    await insertBlock(db, 'manual')
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ source: 'manual' }))
  })
})
