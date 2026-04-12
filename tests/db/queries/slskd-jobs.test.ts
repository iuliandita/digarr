// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '@/db'
import { SLSKD_ACTIVE_JOB_STATES } from '@/db/schema'

const { mockedEq, mockedInArray, mockedAnd, mockedDesc } = vi.hoisted(() => ({
  mockedEq: vi.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right })),
  mockedInArray: vi.fn((left: unknown, right: unknown) => ({ op: 'inArray', left, right })),
  mockedAnd: vi.fn((...clauses: unknown[]) => ({ op: 'and', clauses })),
  mockedDesc: vi.fn((value: unknown) => ({ op: 'desc', value })),
}))

vi.mock('drizzle-orm', () => ({
  and: mockedAnd,
  desc: mockedDesc,
  eq: mockedEq,
  inArray: mockedInArray,
}))

const { createSlskdJob, findActiveSlskdJobByWorkKey, listPendingSlskdJobs, updateSlskdJobState } =
  await import('@/db/queries/slskd-jobs')

function makeDb(
  opts: {
    insertedRows?: Array<Record<string, unknown>>
    insertedRowsSequence?: Array<Array<Record<string, unknown>>>
    selectedRows?: Array<Record<string, unknown>>
    selectedRowsSequence?: Array<Array<Record<string, unknown>>>
    updatedRows?: Array<Record<string, unknown>>
  } = {},
) {
  const insertedRowsSequence = opts.insertedRowsSequence ?? [opts.insertedRows ?? [{ id: 1 }]]
  const selectedRowsSequence = opts.selectedRowsSequence ?? [opts.selectedRows ?? []]
  const updatedRows = opts.updatedRows ?? [{ id: 1 }]

  const insertReturning = vi.fn()
  for (const rows of insertedRowsSequence) {
    insertReturning.mockResolvedValueOnce(rows)
  }
  const insertDoNothing = vi.fn().mockReturnValue({ returning: insertReturning })
  const insertValues = vi.fn().mockReturnValue({ onConflictDoNothing: insertDoNothing })

  const selectLimit = vi.fn()
  for (const rows of selectedRowsSequence) {
    selectLimit.mockResolvedValueOnce(rows)
  }
  const selectOrderBy = vi.fn().mockReturnValue({ limit: selectLimit })
  const selectWhere = vi.fn().mockReturnValue({ orderBy: selectOrderBy, limit: selectLimit })
  const selectFrom = vi.fn().mockReturnValue({
    where: selectWhere,
    orderBy: selectOrderBy,
    limit: selectLimit,
  })

  const updateReturning = vi.fn().mockResolvedValue(updatedRows)
  const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning })
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere })

  return {
    insert: vi.fn().mockReturnValue({ values: insertValues }),
    select: vi.fn().mockReturnValue({ from: selectFrom }),
    update: vi.fn().mockReturnValue({ set: updateSet }),
    _mocks: {
      insertValues,
      insertDoNothing,
      insertReturning,
      selectFrom,
      selectWhere,
      selectOrderBy,
      selectLimit,
      updateSet,
      updateWhere,
      updateReturning,
    },
  }
}

beforeEach(() => {
  mockedEq.mockClear()
  mockedInArray.mockClear()
  mockedAnd.mockClear()
  mockedDesc.mockClear()
})

describe('slskd job queries', () => {
  it('createSlskdJob inserts a row and returns it', async () => {
    const row = { id: 7, state: 'pending' }
    const db = makeDb({ insertedRows: [row] })

    const result = await createSlskdJob(db as unknown as Database, {
      userId: 1,
      targetId: 2,
      sourceType: 'recommendation',
      workKey: 'artist:mbid-1',
      artistMbid: '11111111-1111-1111-1111-111111111111',
      artistName: 'Example Artist',
      releaseTitle: 'Example Release',
    })

    expect(result).toEqual(row)
    expect(db._mocks.insertValues).toHaveBeenCalledOnce()
    expect(db._mocks.insertDoNothing).toHaveBeenCalledOnce()
    expect(db._mocks.insertReturning).toHaveBeenCalledOnce()
  })

  it('createSlskdJob returns the active row when the insert is skipped by conflict', async () => {
    const row = { id: 9, workKey: 'artist:mbid-1', state: 'pending' }
    const db = makeDb({ insertedRows: [], selectedRows: [row] })

    const result = await createSlskdJob(db as unknown as Database, {
      targetId: 2,
      sourceType: 'recommendation',
      workKey: 'artist:mbid-1',
      artistMbid: '11111111-1111-1111-1111-111111111111',
      artistName: 'Example Artist',
      releaseTitle: 'Example Release',
    })

    expect(result).toEqual(row)
    expect(db._mocks.insertDoNothing).toHaveBeenCalledOnce()
    expect(mockedEq).toHaveBeenCalledWith(expect.anything(), 'artist:mbid-1')
    expect(mockedInArray).toHaveBeenCalledWith(expect.anything(), SLSKD_ACTIVE_JOB_STATES)
  })

  it('createSlskdJob retries once when a conflicting active row disappears before lookup', async () => {
    const row = { id: 13, workKey: 'artist:mbid-1', state: 'pending' }
    const db = makeDb({
      insertedRowsSequence: [[], [row]],
      selectedRowsSequence: [[]],
    })

    const result = await createSlskdJob(db as unknown as Database, {
      targetId: 2,
      sourceType: 'recommendation',
      workKey: 'artist:mbid-1',
      artistMbid: '11111111-1111-1111-1111-111111111111',
      artistName: 'Example Artist',
      releaseTitle: 'Example Release',
    })

    expect(result).toEqual(row)
    expect(db._mocks.insertValues).toHaveBeenCalledTimes(2)
    expect(db._mocks.insertDoNothing).toHaveBeenCalledTimes(2)
    expect(db._mocks.insertReturning).toHaveBeenCalledTimes(2)
    expect(db._mocks.selectWhere).toHaveBeenCalledOnce()
  })

  it('createSlskdJob throws when no row is returned', async () => {
    const db = makeDb({ insertedRowsSequence: [[], []], selectedRowsSequence: [[], []] })

    await expect(
      createSlskdJob(db as unknown as Database, {
        targetId: 2,
        sourceType: 'recommendation',
        workKey: 'artist:mbid-1',
        artistMbid: '11111111-1111-1111-1111-111111111111',
        artistName: 'Example Artist',
        releaseTitle: 'Example Release',
      }),
    ).rejects.toThrow('createSlskdJob: no row returned')
    expect(db._mocks.insertReturning).toHaveBeenCalledTimes(2)
  })

  it('findActiveSlskdJobByWorkKey filters on workKey and active states', async () => {
    const row = { id: 9, workKey: 'artist:mbid-1', state: 'queued' }
    const db = makeDb({ selectedRows: [row] })

    const result = await findActiveSlskdJobByWorkKey(db as unknown as Database, 'artist:mbid-1')

    expect(result).toEqual(row)
    expect(mockedEq).toHaveBeenCalledWith(expect.anything(), 'artist:mbid-1')
    expect(mockedInArray).toHaveBeenCalledWith(expect.anything(), SLSKD_ACTIVE_JOB_STATES)
    expect(mockedAnd).toHaveBeenCalledWith(expect.anything(), expect.anything())
    expect(mockedDesc).toHaveBeenNthCalledWith(1, expect.anything())
    expect(mockedDesc).toHaveBeenNthCalledWith(2, expect.anything())
    expect(db._mocks.selectWhere).toHaveBeenCalledOnce()
    expect(db._mocks.selectLimit).toHaveBeenCalledWith(1)
  })

  it('listPendingSlskdJobs filters to active states and orders newest first', async () => {
    const rows = [
      { id: 11, state: 'downloading' },
      { id: 10, state: 'pending' },
    ]
    const db = makeDb({ selectedRows: rows })

    const result = await listPendingSlskdJobs(db as unknown as Database, 25)

    expect(result).toEqual(rows)
    expect(mockedInArray).toHaveBeenCalledWith(expect.anything(), SLSKD_ACTIVE_JOB_STATES)
    expect(mockedDesc).toHaveBeenNthCalledWith(1, expect.anything())
    expect(mockedDesc).toHaveBeenNthCalledWith(2, expect.anything())
    expect(db._mocks.selectWhere).toHaveBeenCalledOnce()
    expect(db._mocks.selectLimit).toHaveBeenCalledWith(25)
  })

  it('updateSlskdJobState returns the updated row and sets completedAt for terminal states', async () => {
    const row = { id: 5, state: 'completed' }
    const db = makeDb({ updatedRows: [row] })

    const result = await updateSlskdJobState(db as unknown as Database, 5, 'completed', {
      slskdSearchId: 'search-1',
      attempts: 2,
    })

    expect(result).toEqual(row)
    expect(mockedEq).toHaveBeenCalledWith(expect.anything(), 5)
    const setArg = db._mocks.updateSet.mock.calls[0]?.[0]
    expect(setArg).toEqual(
      expect.objectContaining({
        state: 'completed',
        slskdSearchId: 'search-1',
        attempts: 2,
      }),
    )
    expect(setArg.completedAt).toBeInstanceOf(Date)
    expect(db._mocks.updateWhere).toHaveBeenCalledOnce()
    expect(db._mocks.updateReturning).toHaveBeenCalledOnce()
  })

  it('updateSlskdJobState throws when no row matches the id', async () => {
    const db = makeDb({ updatedRows: [] })

    await expect(
      updateSlskdJobState(db as unknown as Database, 999, 'queued', {
        slskdQueueId: 'queue-1',
      }),
    ).rejects.toThrow('updateSlskdJobState: no row returned for id 999')
  })
})
