// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createMediaServerQueue,
  MEDIA_SERVER_QUEUE_OPTIONS,
} from '@/core/clients/media-server-queue'

afterEach(() => {
  vi.useRealTimers()
})

describe('media server queue policy', () => {
  it('names the shared per-client limits', () => {
    expect(MEDIA_SERVER_QUEUE_OPTIONS).toEqual({
      concurrency: 3,
      interval: 1000,
      intervalCap: 10,
    })
  })

  it('runs no more than three requests concurrently', async () => {
    const queue = createMediaServerQueue()
    const started: number[] = []
    const releases: Array<() => void> = []

    const tasks = Array.from({ length: 4 }, (_, index) =>
      queue.add(
        () =>
          new Promise<void>((resolve) => {
            started.push(index)
            releases.push(resolve)
          }),
      ),
    )

    await Promise.resolve()
    expect(started).toEqual([0, 1, 2])

    releases[0]?.()
    await Promise.resolve()
    await Promise.resolve()
    expect(started).toEqual([0, 1, 2, 3])

    for (const release of releases.slice(1)) release()
    await Promise.all(tasks)
  })

  it('starts no more than ten requests per second', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    const queue = createMediaServerQueue()
    const started: number[] = []

    const tasks = Array.from({ length: 11 }, (_, index) =>
      queue.add(async () => {
        started.push(index)
      }),
    )

    await queue.onRateLimit()
    expect(started).toHaveLength(10)

    await vi.advanceTimersByTimeAsync(999)
    expect(started).toHaveLength(10)

    await vi.advanceTimersByTimeAsync(1)
    expect(started).toHaveLength(11)
    await Promise.all(tasks)
  })
})
