// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  createSlskdJob,
  findActiveSlskdJobByWorkKey,
  listPendingSlskdJobs,
  updateSlskdJobState,
} from '@/db/queries/slskd-jobs'
import type { Database } from '@/db'

type MockChain = {
  returning: ReturnType<typeof vi.fn>
  values: ReturnType<typeof vi.fn>
  where: ReturnType<typeof vi.fn>
  orderBy: ReturnType<typeof vi.fn>
  limit: ReturnType<typeof vi.fn>
  set: ReturnType<typeof vi.fn>
}

function makeDb(opts: {
  insertedRow?: Record<string, unknown>
  selectedRows?: Array<Record<string, unknown>>
  updatedRows?: Array<Record<string, unknown>>
} = {}) {
  const insertedRow = opts.insertedRow ?? { id: 1 }
  const selectedRows = opts.selectedRows ?? []
  const updatedRows = opts.updatedRows ?? [{ id: 1 }]

  const selectLimit = vi.fn().mockResolvedValue(selectedRows)
  const selectOrderBy = vi.fn().mockReturnValue({ limit: selectLimit })
  const selectWhere = vi.fn().mockReturnValue({ orderBy: selectOrderBy, limit: selectLimit })

  const updateWhere = vi.fn().mockReturnValue(undefined)
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere })
  const insertReturning = vi.fn().mockResolvedValue([insertedRow])
  const insertValues = vi.fn().mockReturnValue({ returning: insertReturning })

  const chain: MockChain = {
    returning: insertReturning as ReturnType<typeof vi.fn>,
    values: insertValues as ReturnType<typeof vi.fn>,
    where: selectWhere as ReturnType<typeof vi.fn>,
    orderBy: selectOrderBy as ReturnType<typeof vi.fn>,
    limit: selectLimit as ReturnType<typeof vi.fn>,
    set: updateSet as ReturnType<typeof vi.fn>,
  }

  const updateReturning = vi.fn().mockResolvedValue(updatedRows)
  updateSet.mockReturnValue({ where: updateWhere })

  const insert = vi.fn().mockReturnValue({ values: insertValues })
  const select = vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: selectWhere,
      orderBy: selectOrderBy,
      limit: selectLimit,
    }),
  })
  const update = vi.fn().mockReturnValue({ set: updateSet })

  return {
    insert,
    select,
    update,
    _mocks: {
      insert,
      select,
      update,
      chain,
      insertValues,
      insertReturning,
      selectWhere,
      selectOrderBy,
      selectLimit,
      updateSet,
      updateWhere,
      updateReturning,
    },
  }
}

describe('slskd job queries', () => {
  it('createSlskdJob inserts a row and returns it', async () => {
    const db = makeDb({ insertedRow: { id: 7, state: 'pending' } })
    const result = await createSlskdJob(db as unknown as Database, {
      userId: 1,
      targetId: 2,
      sourceType: 'recommendation',
      workKey: 'artist:mbid-1',
      artistMbid: '11111111-1111-1111-1111-111111111111',
      artistName: 'Example Artist',
      releaseTitle: 'Example Release',
    })

    expect(result).toEqual({ id: 7, state: 'pending' })
    expect(db._mocks.insert).toHaveBeenCalledOnce()
    expect(db._mocks.insertValues).toHaveBeenCalledOnce()
    expect(db._mocks.insertReturning).toHaveBeenCalledOnce()
  })

  it('findActiveSlskdJobByWorkKey returns the newest active row', async () => {
    const row = { id: 9, workKey: 'artist:mbid-1', state: 'queued' }
    const db = makeDb({ selectedRows: [row] })

    const result = await findActiveSlskdJobByWorkKey(db as unknown as Database, 'artist:mbid-1')

    expect(result).toEqual(row)
    expect(db._mocks.select).toHaveBeenCalledOnce()
    expect(db._mocks.selectWhere).toHaveBeenCalledOnce()
    expect(db._mocks.selectOrderBy).toHaveBeenCalledOnce()
    expect(db._mocks.selectLimit).toHaveBeenCalledWith(1)
  })

  it('listPendingSlskdJobs returns active rows newest first', async () => {
    const rows = [
      { id: 11, state: 'downloading' },
      { id: 10, state: 'pending' },
    ]
    const db = makeDb({ selectedRows: rows })

    const result = await listPendingSlskdJobs(db as unknown as Database, 25)

    expect(result).toEqual(rows)
    expect(db._mocks.select).toHaveBeenCalledOnce()
    expect(db._mocks.selectWhere).toHaveBeenCalledOnce()
    expect(db._mocks.selectOrderBy).toHaveBeenCalledOnce()
    expect(db._mocks.selectLimit).toHaveBeenCalledWith(25)
  })

  it('updateSlskdJobState updates state and extra fields', async () => {
    const db = makeDb()

    await updateSlskdJobState(db as unknown as Database, 5, 'queued', {
      slskdSearchId: 'search-1',
      attempts: 2,
    })

    expect(db._mocks.update).toHaveBeenCalledOnce()
    expect(db._mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        state: 'queued',
        slskdSearchId: 'search-1',
        attempts: 2,
      }),
    )
    expect(db._mocks.updateWhere).toHaveBeenCalledOnce()
  })
})
