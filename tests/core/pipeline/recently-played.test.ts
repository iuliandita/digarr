// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { RecentListen } from '@/core/clients/listenbrainz'
import { loadRecentlyPlayed, recentlyPlayedLeftTooFew } from '@/core/pipeline/recently-played'

const now = new Date('2026-10-19T12:00:00Z')
const nowTs = Math.floor(now.getTime() / 1000)
const DAY = 86_400

function listen(ageDays: number, recordingMbid?: string): RecentListen {
  return { artist: 'A', track: 'T', listenedAt: nowTs - ageDays * DAY, recordingMbid }
}

describe('loadRecentlyPlayed()', () => {
  it('reports missing and reads nothing when the user has no ListenBrainz connection', async () => {
    const history = await loadRecentlyPlayed({ enabled: true, windowDays: 30, readPage: null, now })
    expect(history).toMatchObject({ status: 'missing', listensRead: 0 })
    expect(history.recordingMbids.size).toBe(0)
  })

  it('walks pages back with max_ts and stops at the window start', async () => {
    const readPage = vi
      .fn()
      .mockResolvedValueOnce([listen(1, 'r1'), listen(5)])
      .mockResolvedValueOnce([
        listen(10, 'r2'),
        { ...listen(12, 'redirected-old'), mappedRecordingMbid: 'r3' },
        listen(40, 'too-old'),
      ])

    const history = await loadRecentlyPlayed({
      enabled: true,
      windowDays: 30,
      readPage,
      now,
      pageSize: 2,
    })

    expect(readPage).toHaveBeenNthCalledWith(1, 2, {})
    expect(readPage).toHaveBeenNthCalledWith(2, 2, { maxTs: nowTs - 5 * DAY })
    expect(readPage).toHaveBeenCalledTimes(2)
    expect(history).toMatchObject({ status: 'ok', listensRead: 4 })
    expect([...history.recordingMbids]).toEqual(['r1', 'r2', 'redirected-old', 'r3'])
  })

  it('reports capped when the listen cap is hit inside the window', async () => {
    const readPage = vi.fn(async () => [listen(1, 'r1'), listen(2, 'r2')])
    const history = await loadRecentlyPlayed({
      enabled: true,
      windowDays: 30,
      readPage,
      now,
      pageSize: 2,
      maxListens: 3,
    })
    expect(history).toMatchObject({ status: 'capped', listensRead: 3 })
  })

  it('keeps what it read and reports partial when a page fails', async () => {
    const readPage = vi
      .fn()
      .mockResolvedValueOnce([listen(1, 'r1')])
      .mockRejectedValueOnce(new Error('HTTP 503'))
    const history = await loadRecentlyPlayed({ enabled: true, windowDays: 30, readPage, now })
    expect(history).toMatchObject({ status: 'partial', listensRead: 1, error: 'HTTP 503' })
    expect([...history.recordingMbids]).toEqual(['r1'])
  })
})

describe('recentlyPlayedLeftTooFew()', () => {
  it.each([
    [20, 20, false],
    [20, 4, true],
    [40, 9, true],
    [40, 30, false],
  ])('before %i, kept %i -> %s', (before, kept, expected) => {
    expect(recentlyPlayedLeftTooFew(before, kept)).toBe(expected)
  })
})
