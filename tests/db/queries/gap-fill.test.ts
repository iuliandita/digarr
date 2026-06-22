// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { Database } from '@/db'
import { getArtistsForGapFill, markArtistsGapChecked } from '@/db/queries/gap-fill'

function makeSelectDb(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows)
  const orderBy = vi.fn().mockReturnValue({ limit })
  const where = vi.fn().mockReturnValue({ orderBy })
  const from = vi.fn().mockReturnValue({ where })
  const select = vi.fn().mockReturnValue({ from })
  return {
    db: { select } as unknown as Database,
    select,
    from,
    where,
    orderBy,
    limit,
  }
}

function makeUpdateDb() {
  const where = vi.fn().mockResolvedValue(undefined)
  const set = vi.fn().mockReturnValue({ where })
  const update = vi.fn().mockReturnValue({ set })
  return {
    db: { update } as unknown as Database,
    update,
    set,
    where,
  }
}

describe('getArtistsForGapFill', () => {
  it('returns reconciled artists ordered by the rotation cursor, capped at limit', async () => {
    const rows = [{ id: 1, mbid: 'a', name: 'A' }]
    const { db, select, from, where, orderBy, limit } = makeSelectDb(rows)

    const out = await getArtistsForGapFill(db, 7, 25)

    expect(out).toEqual(rows)
    expect(select).toHaveBeenCalledTimes(1)
    expect(from).toHaveBeenCalledTimes(1)
    expect(where).toHaveBeenCalledTimes(1)
    expect(orderBy).toHaveBeenCalledTimes(1)
    expect(limit).toHaveBeenCalledWith(25)
  })
})

describe('markArtistsGapChecked', () => {
  it('stamps the cursor for the given ids', async () => {
    const { db, update, set, where } = makeUpdateDb()
    await markArtistsGapChecked(db, [1, 2, 3])
    expect(update).toHaveBeenCalledTimes(1)
    expect(set).toHaveBeenCalledTimes(1)
    const arg = set.mock.calls[0]?.[0] as { lastGapCheckAt: Date }
    expect(arg.lastGapCheckAt).toBeInstanceOf(Date)
    expect(where).toHaveBeenCalledTimes(1)
  })

  it('is a no-op for an empty id list', async () => {
    const { db, update } = makeUpdateDb()
    await markArtistsGapChecked(db, [])
    expect(update).not.toHaveBeenCalled()
  })
})
