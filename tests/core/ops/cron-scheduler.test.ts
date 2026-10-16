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

  it.each([
    ['the same schedule', false],
    ['a replaced schedule', true],
  ])('never overlaps a slow run with %s', async (_label, reschedule) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const scheduler = createScheduler()
    let active = 0
    let maxActive = 0
    let release = () => {}
    const fn = vi.fn(async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise<void>((resolve) => {
        release = resolve
      })
      active--
    })
    scheduler.schedule('slow', '* * * * * *', fn)
    await vi.advanceTimersByTimeAsync(1100)
    if (reschedule) scheduler.schedule('slow', '* * * * * *', fn)
    await vi.advanceTimersByTimeAsync(3000)

    expect(fn).toHaveBeenCalledTimes(1)
    release()
    await vi.advanceTimersByTimeAsync(1000)
    expect(fn).toHaveBeenCalledTimes(2)
    expect(maxActive).toBe(1)
  })
})
