// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SubscriptionScheduler } from '@/core/pipeline/subscription-scheduler'

describe('SubscriptionScheduler', () => {
  let scheduler: SubscriptionScheduler

  beforeEach(() => {
    scheduler = new SubscriptionScheduler()
  })

  afterEach(() => {
    scheduler.stopAll()
  })

  it('schedules distinct jobs with metadata and a future nextRun', () => {
    scheduler.schedule('job-a', '0 3 * * *', async () => {})
    scheduler.schedule('job-b', '0 0 * * *', async () => {})

    expect(scheduler.has('job-a')).toBe(true)
    expect(scheduler.has('job-b')).toBe(true)
    const jobs = scheduler.listJobs()
    expect(jobs).toHaveLength(2)
    const a = jobs.find((j) => j.name === 'job-a')
    expect(a?.expression).toBe('0 3 * * *')
    expect(a?.nextRun?.getTime()).toBeGreaterThan(Date.now())
  })

  it('replacing a job with the same name stops the old one', () => {
    scheduler.schedule('dupe', '*/5 * * * *', async () => {})
    scheduler.schedule('dupe', '*/10 * * * *', async () => {})
    expect(scheduler.listJobs()).toHaveLength(1)
    expect(scheduler.listJobs()[0]?.expression).toBe('*/10 * * * *')
  })

  it('throws on invalid cron expression', () => {
    expect(() => scheduler.schedule('bad', 'not a cron', async () => {})).toThrow()
  })

  it('remove drops only the named job and ignores unknown names', () => {
    scheduler.schedule('keep', '*/5 * * * *', async () => {})
    scheduler.schedule('gone', '*/10 * * * *', async () => {})
    scheduler.remove('gone')
    expect(() => scheduler.remove('nonexistent')).not.toThrow()

    expect(scheduler.has('keep')).toBe(true)
    expect(scheduler.has('gone')).toBe(false)
    expect(scheduler.nextRun('gone')).toBeNull()
    expect(scheduler.nextRun('missing')).toBeNull()
  })

  it('stopAll clears every job, is idempotent, and allows scheduling again', () => {
    scheduler.schedule('a', '0 * * * *', async () => {})
    scheduler.schedule('b', '0 0 * * *', async () => {})
    scheduler.stopAll()
    expect(() => scheduler.stopAll()).not.toThrow()
    expect(scheduler.listJobs()).toHaveLength(0)

    scheduler.schedule('after', '0 * * * *', async () => {})
    expect(scheduler.listJobs()).toHaveLength(1)
  })
})
