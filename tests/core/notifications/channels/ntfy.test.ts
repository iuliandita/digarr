// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendNtfyChannel } from '@/core/notifications/channels/ntfy'
import type { NtfyChannel, WebhookPayload } from '@/core/notifications/types'

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async (host: string) => ({
    address: host === 'ntfy.example.com' ? '93.184.216.34' : host,
    family: 4,
  })),
}))

const okFetch = vi.fn(
  async (_url: string, _init?: RequestInit) => new Response(null, { status: 200 }),
)

function makePayload(): WebhookPayload {
  return {
    event: 'batch_complete',
    batchId: 42,
    stats: { discovered: 10, added: 10, failed: 0 },
    message: 'Scan complete: 10 new recommendations found.',
    timestamp: '2025-01-01T00:00:00.000Z',
  }
}

function makeChannel(overrides?: Partial<NtfyChannel>): NtfyChannel {
  return {
    id: 'n1',
    type: 'ntfy',
    enabled: true,
    events: ['batch_complete'],
    server: 'https://ntfy.example.com',
    topic: 'digarr',
    ...overrides,
  }
}

describe('sendNtfyChannel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', okFetch)
    okFetch.mockClear()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('posts the message body to server/topic with Title and Priority headers', async () => {
    const r = await sendNtfyChannel(makeChannel({ priority: 4 }), makePayload())
    expect(r.ok).toBe(true)
    const [url, init] = okFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/digarr')
    const headers = init.headers as Record<string, string>
    expect(headers.Title).toBe('digarr notification')
    expect(headers.Priority).toBe('4')
    expect(init.body).toBe(makePayload().message)
  })

  it('adds Authorization Bearer header only when a token is set', async () => {
    await sendNtfyChannel(makeChannel({ token: 'tk_secret' }), makePayload())
    const [, withInit] = okFetch.mock.calls[0] as [string, RequestInit]
    expect((withInit.headers as Record<string, string>).Authorization).toBe('Bearer tk_secret')

    okFetch.mockClear()
    await sendNtfyChannel(makeChannel(), makePayload())
    const [, noInit] = okFetch.mock.calls[0] as [string, RequestInit]
    expect((noInit.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('strips a trailing slash from the server before joining the topic', async () => {
    await sendNtfyChannel(makeChannel({ server: 'https://ntfy.example.com/' }), makePayload())
    // Transport pins to the resolved IP, so assert the path, not the hostname.
    const [url] = okFetch.mock.calls[0] as [string, RequestInit]
    expect(new URL(url).pathname).toBe('/digarr')
  })
})
