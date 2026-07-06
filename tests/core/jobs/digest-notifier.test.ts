// @vitest-environment node
import type { Cron } from 'croner'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type DigestNotifierDeps,
  startDigestNotifier,
  windowMsFromCron,
} from '@/core/jobs/digest-notifier'

const DAY_MS = 24 * 60 * 60 * 1000

function makeDeps(overrides: Partial<DigestNotifierDeps> = {}): DigestNotifierDeps {
  return {
    getDigestCron: () => '0 6 * * *',
    getWebhookUrl: () => 'https://hooks.example.com/webhook',
    getStats: async () => ({ discovered: 0, added: 0, runs: 0 }),
    sendWebhook: vi.fn().mockResolvedValue(undefined),
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

  it('falls back to 1 day on an invalid cron', () => {
    expect(windowMsFromCron('not a cron')).toBe(DAY_MS)
  })
})

describe('startDigestNotifier', () => {
  let started: Cron | null = null

  afterEach(() => {
    started?.stop()
    started = null
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

  it('does not send when the window had zero activity', async () => {
    const deps = makeDeps({ getStats: async () => ({ discovered: 0, added: 0, runs: 0 }) })
    started = await startDigestNotifier(deps)
    if (started) await fire(started)
    expect(deps.sendWebhook).not.toHaveBeenCalled()
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
})
