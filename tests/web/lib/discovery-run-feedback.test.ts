import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { waitForDiscoveryRunCompletion } from '@/web/lib/discovery-run-feedback'

describe('waitForDiscoveryRunCompletion', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('notifies the caller when a tracked discovery job fails after being accepted', async () => {
    const onFailed = vi.fn()
    const getJob = vi
      .fn()
      .mockResolvedValueOnce({ id: 12, status: 'running', error: null, batchId: null })
      .mockResolvedValueOnce({
        id: 12,
        status: 'failed',
        error: 'Seed artist mbid is not a valid UUID.',
        batchId: null,
      })

    const wait = waitForDiscoveryRunCompletion(12, {
      getJob,
      onFailed,
      pollIntervalMs: 1000,
      maxAttempts: 3,
    })

    await Promise.resolve()
    vi.advanceTimersByTime(1000)
    await Promise.resolve()
    await wait

    expect(getJob).toHaveBeenCalledTimes(2)
    expect(onFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 12,
        status: 'failed',
        error: 'Seed artist mbid is not a valid UUID.',
      }),
    )
  })

  it('stops polling when the job completes and returns the finished job', async () => {
    const onCompleted = vi.fn()
    const getJob = vi.fn().mockResolvedValueOnce({
      id: 7,
      status: 'completed',
      error: null,
      batchId: 44,
    })

    const result = await waitForDiscoveryRunCompletion(7, {
      getJob,
      onCompleted,
      pollIntervalMs: 1000,
      maxAttempts: 2,
    })

    expect(result).toEqual(
      expect.objectContaining({
        id: 7,
        status: 'completed',
        batchId: 44,
      }),
    )
    expect(onCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 7,
        status: 'completed',
      }),
    )
  })
})
