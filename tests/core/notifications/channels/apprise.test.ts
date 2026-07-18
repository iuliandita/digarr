// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendAppriseChannel } from '@/core/notifications/channels/apprise'
import type { AppriseChannel, WebhookPayload } from '@/core/notifications/types'

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async (host: string) => ({
    address: host === 'apprise.example.com' ? '93.184.216.34' : host,
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

function makeChannel(overrides?: Partial<AppriseChannel>): AppriseChannel {
  return {
    id: 'a1',
    type: 'apprise',
    enabled: true,
    events: ['batch_complete'],
    endpoint: 'https://apprise.example.com/notify',
    urls: 'tgram://tok/chat',
    ...overrides,
  }
}

describe('sendAppriseChannel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', okFetch)
    okFetch.mockClear()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('posts a JSON notify body with title, body, type, and normalized urls', async () => {
    const r = await sendAppriseChannel(makeChannel(), makePayload())
    expect(r.ok).toBe(true)
    const [url, init] = okFetch.mock.calls[0] as [string, RequestInit]
    // Transport pins to the resolved IP, so assert the path, not the hostname.
    expect(new URL(url).pathname).toBe('/notify')
    const body = JSON.parse(init.body as string)
    expect(body.body).toBe(makePayload().message)
    expect(body.title).toBe('digarr notification')
    expect(body.type).toBe('info')
    expect(body.urls).toBe('tgram://tok/chat')
  })

  it('normalizes newline-separated urls to a comma-joined string, keeping @ and : intact', async () => {
    await sendAppriseChannel(
      makeChannel({ urls: 'tgram://tok/chat\nmailto://user:pw@example.com' }),
      makePayload(),
    )
    const [, init] = okFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.urls).toBe('tgram://tok/chat,mailto://user:pw@example.com')
  })

  it('drops blank lines and stray commas', async () => {
    await sendAppriseChannel(makeChannel({ urls: 'a\n\n,b, ' }), makePayload())
    const [, init] = okFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.urls).toBe('a,b')
  })
})
