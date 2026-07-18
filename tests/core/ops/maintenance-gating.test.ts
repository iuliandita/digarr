// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startStuckDetector } from '@/core/jobs/stuck-detector'
import { isMaintenance, setMaintenance } from '@/core/ops/maintenance'
import { SubscriptionScheduler } from '@/core/pipeline/subscription-scheduler'
import { PlaylistScheduler } from '@/core/playlists/scheduler'

const EVERY_SECOND = '* * * * * *'

describe('maintenance gating of background schedulers', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  })

  afterEach(() => {
    setMaintenance(false)
    vi.useRealTimers()
  })

  describe('maintenance flag', () => {
    it('toggles', () => {
      expect(isMaintenance()).toBe(false)
      setMaintenance(true)
      expect(isMaintenance()).toBe(true)
      setMaintenance(false)
      expect(isMaintenance()).toBe(false)
    })
  })

  describe('SubscriptionScheduler', () => {
    it('skips ticks during maintenance and resumes after', async () => {
      const scheduler = new SubscriptionScheduler()
      const fn = vi.fn().mockResolvedValue(undefined)
      scheduler.schedule('job', EVERY_SECOND, fn)

      setMaintenance(true)
      await vi.advanceTimersByTimeAsync(1100)
      expect(fn).not.toHaveBeenCalled()

      setMaintenance(false)
      await vi.advanceTimersByTimeAsync(1100)
      expect(fn).toHaveBeenCalled()

      scheduler.stopAll()
    })
  })

  describe('PlaylistScheduler', () => {
    it('skips ticks during maintenance and resumes after', async () => {
      const scheduler = new PlaylistScheduler()
      const fn = vi.fn().mockResolvedValue(undefined)
      scheduler.schedule('job', EVERY_SECOND, fn)

      setMaintenance(true)
      await vi.advanceTimersByTimeAsync(1100)
      expect(fn).not.toHaveBeenCalled()

      setMaintenance(false)
      await vi.advanceTimersByTimeAsync(1100)
      expect(fn).toHaveBeenCalled()

      scheduler.stopAll()
    })
  })

  describe('startStuckDetector', () => {
    it('skips markStuck during maintenance and resumes after', async () => {
      const recorder = {
        start: vi.fn(),
        complete: vi.fn(),
        fail: vi.fn(),
        cancel: vi.fn().mockResolvedValue(undefined),
        markStuck: vi.fn().mockResolvedValue(0),
      }
      const cron = startStuckDetector(recorder)

      setMaintenance(true)
      await vi.advanceTimersByTimeAsync(5 * 60_000 + 1000)
      expect(recorder.markStuck).not.toHaveBeenCalled()

      setMaintenance(false)
      await vi.advanceTimersByTimeAsync(5 * 60_000 + 1000)
      expect(recorder.markStuck).toHaveBeenCalled()

      cron.stop()
    })
  })
})
