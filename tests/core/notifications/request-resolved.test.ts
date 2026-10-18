// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { notifyRequestResolved } from '@/core/notifications/request-resolved'
import type { NotificationChannel, WebhookPayload } from '@/core/notifications/types'
import { mergePreferences } from '@/db/schema'

const channel = (id: string, events: NotificationChannel['events']): NotificationChannel => ({
  id,
  type: 'webhook',
  enabled: true,
  url: `https://example.com/${id}`,
  events,
})

describe('request resolution notifications', () => {
  it('only sends opted-in requester channels and localizes the outcome', async () => {
    const webhook = vi.fn(async (_channel: NotificationChannel, _payload: WebhookPayload) => ({
      ok: true,
    }))
    const results = await notifyRequestResolved(
      {
        preferredLocale: 'de',
        preferences: mergePreferences({
          channels: [
            channel('old', ['batch_complete', 'digest']),
            channel('requester', ['request_resolved']),
          ],
        }),
      },
      { recommendationId: 42, status: 'approved', artistName: 'Artist' },
      { senders: { webhook } },
    )
    expect(results).toHaveLength(1)
    expect(webhook).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'requester' }),
      expect.objectContaining({
        event: 'request_resolved',
        recommendationId: 42,
        status: 'approved',
        message: expect.stringContaining('Artist'),
      }),
    )
    expect(webhook.mock.calls[0]?.[1]?.message).not.toContain('approved')
  })

  it('does not fall back to global channels for a requester without channels', async () => {
    const webhook = vi.fn(async (_channel: NotificationChannel, _payload: WebhookPayload) => ({
      ok: true,
    }))
    expect(
      await notifyRequestResolved(
        { preferences: null },
        { recommendationId: 42, status: 'declined', artistName: 'Artist' },
        { senders: { webhook } },
      ),
    ).toEqual([])
    expect(webhook).not.toHaveBeenCalled()
  })
})
