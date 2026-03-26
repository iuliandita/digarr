// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlaylistScheduler } from '@/core/playlists/scheduler'

describe('PlaylistScheduler', () => {
  let scheduler: PlaylistScheduler

  beforeEach(() => {
    scheduler = new PlaylistScheduler()
  })

  afterEach(() => {
    scheduler.stopAll()
  })

  it('adds named jobs and exposes them via has()', () => {
    scheduler.schedule('playlist-1', '0 6 * * 1', async () => {})

    expect(scheduler.has('playlist-1')).toBe(true)
  })

  it('replaces an existing job with the same name', () => {
    scheduler.schedule('playlist-1', '0 6 * * 1', async () => {})
    scheduler.schedule('playlist-1', '0 8 * * 0', async () => {})

    expect(scheduler.listJobs()).toHaveLength(1)
    expect(scheduler.listJobs()[0]?.expression).toBe('0 8 * * 0')
  })

  it('returns the next run for a named job', () => {
    scheduler.schedule('playlist-1', '0 6 * * 1', async () => {})

    const next = scheduler.nextRun('playlist-1')

    expect(next).toBeInstanceOf(Date)
  })

  it('returns the earliest next run when called without a name', () => {
    scheduler.schedule('playlist-1', '0 6 * * 1', async () => {})
    scheduler.schedule('playlist-2', '0 8 * * 0', async () => {})

    const earliest = scheduler.nextRun()
    const allRuns = scheduler
      .listJobs()
      .map((job) => job.nextRun)
      .filter((run): run is Date => run instanceof Date)
      .sort((a, b) => a.getTime() - b.getTime())

    expect(earliest?.toISOString()).toBe(allRuns[0]?.toISOString())
  })

  it('removes a job cleanly', () => {
    scheduler.schedule('playlist-1', '0 6 * * 1', async () => {})

    scheduler.remove('playlist-1')

    expect(scheduler.has('playlist-1')).toBe(false)
    expect(scheduler.nextRun('playlist-1')).toBeNull()
  })

  it('stopAll clears every scheduled playlist job', () => {
    scheduler.schedule('playlist-1', '0 6 * * 1', async () => {})
    scheduler.schedule('playlist-2', '0 8 * * 0', async () => {})

    scheduler.stopAll()

    expect(scheduler.listJobs()).toEqual([])
  })

  it('swallows callback errors when the job is triggered', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    scheduler.schedule('playlist-1', '* * * * * *', async () => {
      throw new Error('boom')
    })

    const internalJob = (
      scheduler as unknown as { jobs: Map<string, { cron: { trigger: () => Promise<void> } }> }
    ).jobs.get('playlist-1')

    await expect(internalJob?.cron.trigger()).resolves.toBeUndefined()

    consoleSpy.mockRestore()
  })
})
