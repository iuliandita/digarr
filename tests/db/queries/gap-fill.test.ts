// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { Database } from '@/db'
import { markArtistsGapChecked } from '@/db/queries/gap-fill'

function makeUpdateDb() {
  const where = vi.fn().mockResolvedValue(undefined)
  const set = vi.fn().mockReturnValue({ where })
  const update = vi.fn().mockReturnValue({ set })
  return {
    db: { update } as unknown as Database,
    update,
    set,
  }
}

describe('markArtistsGapChecked', () => {
  it('stamps the cursor for the given ids', async () => {
    const { db, set } = makeUpdateDb()
    await markArtistsGapChecked(db, [1, 2, 3])
    const arg = set.mock.calls[0]?.[0] as { lastGapCheckAt: Date }
    expect(arg.lastGapCheckAt).toBeInstanceOf(Date)
  })

  it('is a no-op for an empty id list', async () => {
    const { db, update } = makeUpdateDb()
    await markArtistsGapChecked(db, [])
    expect(update).not.toHaveBeenCalled()
  })
})
