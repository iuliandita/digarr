// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { dispatch } from '@/core/notifications/registry'
import type { WebhookChannel, WebhookPayload } from '@/core/notifications/types'

function makePayload(): WebhookPayload {
  return {
    event: 'batch_complete',
    batchId: 1,
    stats: { discovered: 1, added: 1, failed: 0 },
    message: 'test',
    timestamp: '2025-01-01T00:00:00.000Z',
  }
}

function channel(id: string, over: Partial<WebhookChannel> = {}): WebhookChannel {
  return {
    id,
    type: 'webhook',
    enabled: true,
    events: ['batch_complete'],
    url: `https://example.com/${id}`,
    ...over,
  }
}

describe('dispatch', () => {
  it('only sends to enabled channels subscribed to the event', async () => {
    const webhook = vi.fn(async () => ({ ok: true }))
    const channels = [
      channel('a'),
      channel('b', { enabled: false }),
      channel('c', { events: ['digest'] }),
    ]

    const results = await dispatch(channels, 'batch_complete', makePayload(), {
      senders: { webhook },
    })

    expect(webhook).toHaveBeenCalledOnce()
    expect(results).toEqual([{ id: 'a', type: 'webhook', ok: true, error: undefined }])
  })

  it('isolates a failing channel from a succeeding one', async () => {
    const webhook = vi.fn(async (c: WebhookChannel) =>
      c.id === 'bad' ? { ok: false, error: 'boom' } : { ok: true },
    )
    const results = await dispatch(
      [channel('good'), channel('bad')],
      'batch_complete',
      makePayload(),
      {
        senders: { webhook },
      },
    )

    expect(results).toEqual([
      { id: 'good', type: 'webhook', ok: true, error: undefined },
      { id: 'bad', type: 'webhook', ok: false, error: 'boom' },
    ])
  })

  it('does not reject the whole dispatch when a sender throws', async () => {
    const webhook = vi.fn(async (c: WebhookChannel) => {
      if (c.id === 'throws') throw new Error('kaboom')
      return { ok: true }
    })
    const results = await dispatch(
      [channel('ok'), channel('throws')],
      'batch_complete',
      makePayload(),
      {
        senders: { webhook },
      },
    )

    expect(results[0]).toEqual({ id: 'ok', type: 'webhook', ok: true, error: undefined })
    expect(results[1]?.ok).toBe(false)
    expect(results[1]?.error).toContain('kaboom')
  })

  it('returns an empty array for undefined channels', async () => {
    expect(await dispatch(undefined, 'batch_complete', makePayload())).toEqual([])
  })
})
