// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendTelegramChannel } from '@/core/notifications/channels/telegram'
import type { TelegramChannel, WebhookPayload } from '@/core/notifications/types'

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async (host: string) => ({
    address: host === 'api.telegram.org' ? '93.184.216.34' : host,
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

function makeChannel(overrides?: Partial<TelegramChannel>): TelegramChannel {
  return {
    id: 't1',
    type: 'telegram',
    enabled: true,
    events: ['batch_complete'],
    botToken: '123:ABC',
    chatId: '-1001',
    ...overrides,
  }
}

describe('sendTelegramChannel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', okFetch)
    okFetch.mockClear()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('posts to the bot sendMessage endpoint', async () => {
    const r = await sendTelegramChannel(makeChannel(), makePayload())
    expect(r.ok).toBe(true)
    const [url] = okFetch.mock.calls[0] as [string, RequestInit]
    expect(new URL(url).pathname).toBe('/bot123:ABC/sendMessage')
  })

  it('sends a JSON body with chat_id and text and no parse_mode', async () => {
    await sendTelegramChannel(makeChannel(), makePayload())
    const [, init] = okFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body).toEqual({ chat_id: '-1001', text: makePayload().message })
    expect(body.parse_mode).toBeUndefined()
  })

  it('masks the bot token in failure logs (no token leak)', async () => {
    const failFetch = vi.fn(async () => new Response(null, { status: 500 }))
    vi.stubGlobal('fetch', failFetch)
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const r = await sendTelegramChannel(makeChannel({ botToken: 'SECRET:token' }), makePayload())
    expect(r.ok).toBe(false)

    const logged = errSpy.mock.calls.map((args) => args.join(' ')).join('\n')
    expect(logged).toContain('/bot[REDACTED]/')
    expect(logged).not.toContain('SECRET:token')

    errSpy.mockRestore()
  })
})
