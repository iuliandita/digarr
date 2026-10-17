// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlaylistScheduler, schedulePlaylists } from '@/core/playlists/scheduler'

const WEEKLY_MONDAY = '0 8 * * 1'
const WEEKLY_SUNDAY = '0 8 * * 0'

describe('schedulePlaylists', () => {
  let scheduler: PlaylistScheduler

  beforeEach(() => {
    vi.useFakeTimers()
    // Local time, one minute before Monday 08:00, matching croner's local-time evaluation.
    vi.setSystemTime(new Date(2026, 9, 19, 7, 59, 0))
    scheduler = new PlaylistScheduler()
  })

  afterEach(() => {
    scheduler.stopAll()
    vi.useRealTimers()
  })

  const playlists = [
    { id: 1, schedule: WEEKLY_MONDAY },
    { id: 2, schedule: WEEKLY_SUNDAY },
    { id: 3, schedule: null },
  ]

  it('fires generation for a due weekly playlist when scheduling is enabled', async () => {
    const generate = vi.fn().mockResolvedValue(undefined)
    schedulePlaylists(scheduler, { enabled: true, playlists, generate })

    expect(scheduler.listJobs().map((job) => job.name)).toEqual(['playlist-1', 'playlist-2'])
    await vi.advanceTimersByTimeAsync(61_000)

    expect(generate).toHaveBeenCalledExactlyOnceWith(1)
  })

  it('schedules nothing while the global switch is off', async () => {
    const generate = vi.fn().mockResolvedValue(undefined)
    schedulePlaylists(scheduler, { enabled: true, playlists, generate })
    schedulePlaylists(scheduler, { enabled: false, playlists, generate })

    expect(scheduler.listJobs()).toEqual([])
    await vi.advanceTimersByTimeAsync(7 * 24 * 60 * 60_000)

    expect(generate).not.toHaveBeenCalled()
  })

  it('keeps scheduling the rest when one stored cron is invalid', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    schedulePlaylists(scheduler, {
      enabled: true,
      playlists: [{ id: 9, schedule: 'not a cron' }, ...playlists],
      generate: vi.fn().mockResolvedValue(undefined),
    })

    expect(scheduler.listJobs().map((job) => job.name)).toEqual(['playlist-1', 'playlist-2'])
  })
})
