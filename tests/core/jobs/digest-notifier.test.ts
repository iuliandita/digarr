// @vitest-environment node
import type { Cron } from 'croner'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type DigestNotifierDeps,
  startDigestNotifier,
  windowMsFromCron,
} from '@/core/jobs/digest-notifier'
import { setMaintenance } from '@/core/ops/maintenance'

const DAY_MS = 24 * 60 * 60 * 1000

function makeDeps(overrides: Partial<DigestNotifierDeps> = {}): DigestNotifierDeps {
  return {
    getDigestCron: () => '0 6 * * *',
    getWebhookUrl: () => 'https://hooks.example.com/webhook',
    getStats: async () => ({ discovered: 0, added: 0, runs: 0 }),
    sendWebhook: vi.fn().mockResolvedValue(undefined),
    getLastSentAt: vi.fn().mockResolvedValue(null),
    setLastSentAt: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

/** Trigger the cron's scheduled callback and await its body. */
async function fire(cron: Cron): Promise<void> {
  await cron.trigger()
}

describe('windowMsFromCron', () => {
  it('derives ~1 day for a daily cron, fired at the scheduled time', () => {
    // 2024-01-05 (Friday) 06:00 local, a fire of '0 6 * * *'.
    const from = new Date(2024, 0, 5, 6, 0, 0, 0)
    expect(windowMsFromCron('0 6 * * *', from)).toBe(DAY_MS)
  })

  it('derives ~7 days for a weekly cron, fired at the scheduled time', () => {
    // 2024-01-08 (Monday) 06:00 local, a fire of '0 6 * * 1'.
    const from = new Date(2024, 0, 8, 6, 0, 0, 0)
    expect(windowMsFromCron('0 6 * * 1', from)).toBe(7 * DAY_MS)
  })

  it('derives the actual elapsed interval for an irregular Mon+Fri cron', () => {
    // 2024-01-05 (Friday) 08:00 local, a fire of '0 8 * * 1,5'. The
    // previous fire was Monday 2024-01-01, so the elapsed window is 4
    // days -- NOT the 3-day gap to the *next* fire (the following Monday),
    // which is what the old future-gap derivation returned.
    const from = new Date(2024, 0, 5, 8, 0, 0, 0)
    expect(windowMsFromCron('0 8 * * 1,5', from)).toBe(4 * DAY_MS)
  })

  it('derives the elapsed interval when the tick fires seconds late', () => {
    // Friday 08:00:05 -- the tick ran 5s after the scheduled fire, so the
    // Friday fire itself shows up as a "previous" run and must be skipped;
    // the window still reaches back to Monday.
    const from = new Date(2024, 0, 5, 8, 0, 5, 0)
    expect(windowMsFromCron('0 8 * * 1,5', from)).toBe(4 * DAY_MS + 5000)
  })

  it('falls back to 1 day on an invalid cron', () => {
    expect(windowMsFromCron('not a cron')).toBe(DAY_MS)
  })
})

describe('startDigestNotifier', () => {
  let started: Cron | null = null

  afterEach(() => {
    started?.stop()
    started = null
    setMaintenance(false)
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('returns null (no job) when digestCron is unset', async () => {
    const deps = makeDeps({ getDigestCron: () => undefined })
    started = await startDigestNotifier(deps)
    expect(started).toBeNull()
    expect(deps.sendWebhook).not.toHaveBeenCalled()
  })

  it('does not send when webhookUrl is unset at fire time', async () => {
    const deps = makeDeps({
      getWebhookUrl: () => undefined,
      getStats: async () => ({ discovered: 5, added: 2, runs: 1 }),
    })
    started = await startDigestNotifier(deps)
    expect(started).not.toBeNull()
    if (started) await fire(started)
    expect(deps.sendWebhook).not.toHaveBeenCalled()
  })

  it('does not send when the window had zero activity, but still advances the bookmark', async () => {
    const deps = makeDeps({ getStats: async () => ({ discovered: 0, added: 0, runs: 0 }) })
    started = await startDigestNotifier(deps)
    if (started) await fire(started)
    expect(deps.sendWebhook).not.toHaveBeenCalled()
    expect(deps.setLastSentAt).toHaveBeenCalledOnce()
  })

  it('sends a digest payload with aggregated stats when there was activity', async () => {
    const sendWebhook = vi.fn().mockResolvedValue(undefined)
    const deps = makeDeps({
      getStats: async () => ({ discovered: 9, added: 3, runs: 4 }),
      sendWebhook,
    })
    started = await startDigestNotifier(deps)
    if (started) await fire(started)

    expect(sendWebhook).toHaveBeenCalledOnce()
    const [url, payload] = sendWebhook.mock.calls[0] ?? []
    expect(url).toBe('https://hooks.example.com/webhook')
    expect(payload).toMatchObject({
      event: 'digest',
      window: 'day',
      stats: { discovered: 9, added: 3, runs: 4 },
    })
    expect(typeof payload.message).toBe('string')
    expect(payload.message.length).toBeGreaterThan(0)
    expect(typeof payload.timestamp).toBe('string')
  })

  it('swallows errors from the stats query', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const sendWebhook = vi.fn()
    const deps = makeDeps({
      getStats: async () => {
        throw new Error('db down')
      },
      sendWebhook,
    })
    started = await startDigestNotifier(deps)
    if (started) await fire(started)

    expect(sendWebhook).not.toHaveBeenCalled()
    expect(consoleSpy).toHaveBeenCalledWith('[digest-notifier] Failed:', expect.any(Error))
  })

  it('uses the persisted bookmark as the window start when set', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2024, 0, 5, 6, 0, 0, 0))
    const bookmark = new Date(2024, 0, 2, 6, 0, 0, 0)
    const getStats = vi.fn().mockResolvedValue({ discovered: 1, added: 0, runs: 1 })
    const deps = makeDeps({
      getLastSentAt: vi.fn().mockResolvedValue(bookmark),
      getStats,
    })
    started = await startDigestNotifier(deps)
    if (started) await fire(started)

    expect(getStats).toHaveBeenCalledOnce()
    expect(getStats.mock.calls[0]?.[0]).toEqual(bookmark)
    expect(deps.sendWebhook).toHaveBeenCalledOnce()
  })

  it('falls back to the cron-derived window when the bookmark is null', async () => {
    vi.useFakeTimers()
    // Friday 06:00 local, a fire of '0 6 * * *': previous fire is 24h back.
    vi.setSystemTime(new Date(2024, 0, 5, 6, 0, 0, 0))
    const getStats = vi.fn().mockResolvedValue({ discovered: 1, added: 0, runs: 1 })
    const deps = makeDeps({ getLastSentAt: vi.fn().mockResolvedValue(null), getStats })
    started = await startDigestNotifier(deps)
    if (started) await fire(started)

    expect(getStats.mock.calls[0]?.[0]).toEqual(new Date(2024, 0, 4, 6, 0, 0, 0))
  })

  it('falls back to the cron-derived window when the bookmark is in the future', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2024, 0, 5, 6, 0, 0, 0))
    const futureBookmark = new Date(2024, 0, 5, 7, 0, 0, 0)
    const getStats = vi.fn().mockResolvedValue({ discovered: 1, added: 0, runs: 1 })
    const deps = makeDeps({ getLastSentAt: vi.fn().mockResolvedValue(futureBookmark), getStats })
    started = await startDigestNotifier(deps)
    if (started) await fire(started)

    expect(getStats.mock.calls[0]?.[0]).toEqual(new Date(2024, 0, 4, 6, 0, 0, 0))
  })

  it('advances the bookmark only after a successful send', async () => {
    const sendWebhook = vi.fn().mockResolvedValue(undefined)
    const setLastSentAt = vi.fn().mockResolvedValue(undefined)
    const deps = makeDeps({
      getStats: async () => ({ discovered: 2, added: 1, runs: 1 }),
      sendWebhook,
      setLastSentAt,
    })
    started = await startDigestNotifier(deps)
    if (started) await fire(started)

    expect(sendWebhook).toHaveBeenCalledOnce()
    expect(setLastSentAt).toHaveBeenCalledOnce()
    const sendOrder = sendWebhook.mock.invocationCallOrder[0]
    const bookmarkOrder = setLastSentAt.mock.invocationCallOrder[0]
    expect(bookmarkOrder).toBeGreaterThan(sendOrder ?? Number.POSITIVE_INFINITY)
  })

  it('does not advance the bookmark when the send fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const setLastSentAt = vi.fn().mockResolvedValue(undefined)
    const deps = makeDeps({
      getStats: async () => ({ discovered: 2, added: 1, runs: 1 }),
      sendWebhook: vi.fn().mockRejectedValue(new Error('webhook down')),
      setLastSentAt,
    })
    started = await startDigestNotifier(deps)
    if (started) await fire(started)

    expect(setLastSentAt).not.toHaveBeenCalled()
    expect(consoleSpy).toHaveBeenCalledWith('[digest-notifier] Failed:', expect.any(Error))
  })

  it('skips the tick entirely during maintenance', async () => {
    const getLastSentAt = vi.fn().mockResolvedValue(null)
    const deps = makeDeps({
      getLastSentAt,
      getStats: async () => ({ discovered: 5, added: 2, runs: 1 }),
    })
    started = await startDigestNotifier(deps)
    setMaintenance(true)
    if (started) await fire(started)

    expect(getLastSentAt).not.toHaveBeenCalled()
    expect(deps.sendWebhook).not.toHaveBeenCalled()
    expect(deps.setLastSentAt).not.toHaveBeenCalled()
  })
})
