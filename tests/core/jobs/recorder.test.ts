// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createJobRecorder } from '@/core/jobs/recorder'

// Build a mock db that covers insert().values().returning() and update().set().where() / .returning()
function makeDb(opts: { insertedId?: number; updatedRows?: number } = {}) {
  const { insertedId = 42, updatedRows = 1 } = opts

  const returning = vi.fn().mockResolvedValue([{ id: insertedId }])

  const updateReturning = vi
    .fn()
    .mockResolvedValue(Array.from({ length: updatedRows }, (_, i) => ({ id: insertedId + i })))
  const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning })
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere })
  const update = vi.fn().mockReturnValue({ set: updateSet })

  const insertValues = vi.fn().mockReturnValue({ returning })
  const insert = vi.fn().mockReturnValue({ values: insertValues })

  return {
    insert,
    update,
    // expose internals for assertions
    _mocks: { insert, insertValues, returning, update, updateSet, updateWhere, updateReturning },
  }
}

describe('createJobRecorder', () => {
  describe('start()', () => {
    it('inserts a running job row and returns the new id', async () => {
      const db = makeDb({ insertedId: 7 })
      const recorder = createJobRecorder(db as never)

      const id = await recorder.start({ type: 'pipeline', userId: 1 })

      expect(id).toBe(7)
      expect(db._mocks.insert).toHaveBeenCalledOnce()
      expect(db._mocks.insertValues).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'pipeline', status: 'running', userId: 1 }),
      )
      expect(db._mocks.returning).toHaveBeenCalledOnce()
    })

    it('sets userId and subscriptionId to null when omitted', async () => {
      const db = makeDb()
      const recorder = createJobRecorder(db as never)

      await recorder.start({ type: 'subscription' })

      expect(db._mocks.insertValues).toHaveBeenCalledWith(
        expect.objectContaining({ userId: null, subscriptionId: null }),
      )
    })

    it('passes metadata when provided', async () => {
      const db = makeDb()
      const recorder = createJobRecorder(db as never)
      const meta = { triggerSource: 'manual', limit: 50 }

      await recorder.start({ type: 'quick_discover', metadata: meta })

      expect(db._mocks.insertValues).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: meta }),
      )
    })

    it('defaults metadata to empty object when not provided', async () => {
      const db = makeDb()
      const recorder = createJobRecorder(db as never)

      await recorder.start({ type: 'target' })

      expect(db._mocks.insertValues).toHaveBeenCalledWith(expect.objectContaining({ metadata: {} }))
    })

    it('throws when insert returns no row', async () => {
      const db = makeDb()
      db._mocks.returning.mockResolvedValueOnce([])
      const recorder = createJobRecorder(db as never)

      await expect(recorder.start({ type: 'pipeline' })).rejects.toThrow(
        'insertJobRun: no row returned',
      )
    })
  })

  describe('complete()', () => {
    it('updates status to completed', async () => {
      const db = makeDb()
      const recorder = createJobRecorder(db as never)

      await recorder.complete(42)

      expect(db._mocks.update).toHaveBeenCalledOnce()
      expect(db._mocks.updateSet).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'completed' }),
      )
      expect(db._mocks.updateWhere).toHaveBeenCalledOnce()
    })

    it('sets completedAt timestamp', async () => {
      const db = makeDb()
      const recorder = createJobRecorder(db as never)

      await recorder.complete(1)

      const setArg = db._mocks.updateSet.mock.calls[0]?.[0]
      expect(setArg).toBeDefined()
      expect(setArg.completedAt).toBeInstanceOf(Date)
    })

    it('includes sourceResults when provided', async () => {
      const db = makeDb()
      const recorder = createJobRecorder(db as never)
      const sourceResults = { listenbrainz: { status: 'ok' as const, artists: 10, ms: 300 } }

      await recorder.complete(1, { sourceResults })

      expect(db._mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({ sourceResults }))
    })

    it('includes batchId when provided', async () => {
      const db = makeDb()
      const recorder = createJobRecorder(db as never)

      await recorder.complete(1, { batchId: 99 })

      expect(db._mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({ batchId: 99 }))
    })

    it('omits sourceResults and batchId when not provided', async () => {
      const db = makeDb()
      const recorder = createJobRecorder(db as never)

      await recorder.complete(1)

      const setArg = db._mocks.updateSet.mock.calls[0]?.[0]
      expect(setArg).toBeDefined()
      expect(setArg.sourceResults).toBeUndefined()
      expect(setArg.batchId).toBeUndefined()
    })
  })

  describe('fail()', () => {
    it('updates status to failed with error message', async () => {
      const db = makeDb()
      const recorder = createJobRecorder(db as never)

      await recorder.fail(5, 'something exploded')

      expect(db._mocks.update).toHaveBeenCalledOnce()
      expect(db._mocks.updateSet).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'failed', error: 'something exploded' }),
      )
      expect(db._mocks.updateWhere).toHaveBeenCalledOnce()
    })

    it('sets completedAt timestamp', async () => {
      const db = makeDb()
      const recorder = createJobRecorder(db as never)

      await recorder.fail(5, 'err')

      const setArg = db._mocks.updateSet.mock.calls[0]?.[0]
      expect(setArg).toBeDefined()
      expect(setArg.completedAt).toBeInstanceOf(Date)
    })
  })

  describe('markStuck()', () => {
    it('returns 0 when no jobs are stuck', async () => {
      const db = makeDb({ updatedRows: 0 })
      const recorder = createJobRecorder(db as never)

      const count = await recorder.markStuck()

      expect(count).toBe(0)
    })

    it('calls update once per job type', async () => {
      const db = makeDb({ updatedRows: 0 })
      const recorder = createJobRecorder(db as never)

      await recorder.markStuck()

      // 6 job types: pipeline, quick_discover, subscription, target, playlist, library_sync
      expect(db._mocks.update).toHaveBeenCalledTimes(6)
    })

    it('returns total count of stuck jobs across all types', async () => {
      const db = makeDb({ updatedRows: 2 })
      const recorder = createJobRecorder(db as never)

      const count = await recorder.markStuck()

      // 6 types * 2 rows each = 12
      expect(count).toBe(12)
    })

    it('updates status to stuck', async () => {
      const db = makeDb({ updatedRows: 1 })
      const recorder = createJobRecorder(db as never)

      await recorder.markStuck()

      expect(db._mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'stuck' }))
    })
  })
})
