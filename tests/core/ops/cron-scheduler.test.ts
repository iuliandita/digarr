// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest'
import { CronScheduler } from '@/core/ops/cron-scheduler'

describe('CronScheduler', () => {
  const schedulers: CronScheduler[] = []

  afterEach(() => {
    for (const scheduler of schedulers) scheduler.stopAll()
    schedulers.length = 0
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function createScheduler(logPrefix = '[custom]') {
    const scheduler = new CronScheduler(logPrefix)
    schedulers.push(scheduler)
    return scheduler
  }

  it('returns named and earliest next runs', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const scheduler = createScheduler()
    scheduler.schedule('later', '2 * * * * *', async () => {})
    scheduler.schedule('earlier', '1 * * * * *', async () => {})

    expect(scheduler.nextRun('later')).toEqual(new Date('2026-01-01T00:00:02Z'))
    expect(scheduler.nextRun()).toEqual(new Date('2026-01-01T00:00:01Z'))
  })

  it('logs callback failures with its configured prefix', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const scheduler = createScheduler('[custom-scheduler]')
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new Error('boom')
    scheduler.schedule('err-job', '* * * * * *', async () => {
      throw error
    })

    await vi.advanceTimersByTimeAsync(1100)
    expect(consoleSpy).toHaveBeenCalledWith(
      "[custom-scheduler] Job 'err-job' (* * * * * *) failed:",
      error,
    )
  })
})
