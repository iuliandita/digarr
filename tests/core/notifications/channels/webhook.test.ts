// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  formatDiscordPayload,
  sendWebhookChannel,
  signatureHeaders,
} from '@/core/notifications/channels/webhook'
import type { WebhookChannel, WebhookPayload } from '@/core/notifications/types'

const RESOLVABLE = new Set(['discord.com', 'generic.example', 'notdiscord.com'])
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async (host: string) => ({
    address: RESOLVABLE.has(host) ? '93.184.216.34' : host,
    family: 4,
  })),
}))

const okFetch = vi.fn(
  async (_url: string, _init?: RequestInit) => new Response(null, { status: 204 }),
)

function makePayload(overrides?: Partial<Extract<WebhookPayload, { event: 'batch_complete' }>>) {
  return {
    event: 'batch_complete' as const,
    batchId: 42,
    stats: { discovered: 10, added: 10, failed: 0 },
    message: 'Scan complete: 10 new recommendations found.',
    timestamp: '2025-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeChannel(url: string): WebhookChannel {
  return { id: 'w1', type: 'webhook', enabled: true, events: ['batch_complete'], url }
}

describe('sendWebhookChannel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', okFetch)
    okFetch.mockClear()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('posts the raw payload to a generic host', async () => {
    const r = await sendWebhookChannel(makeChannel('https://generic.example/hook'), makePayload())
    expect(r.ok).toBe(true)
    const [, init] = okFetch.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual(makePayload())
  })

  it('posts a Discord embed to a discord.com host', async () => {
    const r = await sendWebhookChannel(
      makeChannel('https://discord.com/api/webhooks/123/abc'),
      makePayload(),
    )
    expect(r.ok).toBe(true)
    const [, init] = okFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as { embeds?: unknown[] }
    expect(Array.isArray(body.embeds)).toBe(true)
    expect(body.embeds?.length).toBe(1)
  })

  it('does not treat a lookalike host as Discord (dot-boundary match)', async () => {
    const r = await sendWebhookChannel(
      makeChannel('https://notdiscord.com/api/webhooks/123/abc'),
      makePayload(),
    )
    expect(r.ok).toBe(true)
    const [, init] = okFetch.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual(makePayload())
  })
})

describe('webhook signing', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', okFetch)
    okFetch.mockClear()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('matches the documented test vector', () => {
    expect(
      signatureHeaders('whsec_test', '{"event":"digest","message":"hello"}', 1700000000),
    ).toEqual({
      'X-Digarr-Timestamp': '1700000000',
      'X-Digarr-Signature':
        'sha256=69063f9268083f6b8a9f648b71756b35fb62251050afe40fec18f25dd4b5a737',
    })
  })

  it('signs the exact body that is sent when a secret is set', async () => {
    const channel = { ...makeChannel('https://generic.example/hook'), signingSecret: 'whsec_test' }
    await sendWebhookChannel(channel, makePayload())
    const [, init] = okFetch.mock.calls[0] as [string, RequestInit]
    const headers = new Headers(init.headers)
    const expected = signatureHeaders(
      'whsec_test',
      init.body as string,
      Number(headers.get('x-digarr-timestamp')),
    )
    expect(headers.get('x-digarr-signature')).toBe(expected['X-Digarr-Signature'])
  })

  it('sends no signing headers without a secret', async () => {
    await sendWebhookChannel(makeChannel('https://generic.example/hook'), makePayload())
    const [, init] = okFetch.mock.calls[0] as [string, RequestInit]
    const headers = new Headers(init.headers)
    expect(headers.get('x-digarr-signature')).toBeNull()
    expect(headers.get('x-digarr-timestamp')).toBeNull()
  })
})

describe('formatDiscordPayload', () => {
  it('builds a Scan Complete embed for batch_complete', () => {
    const embed = formatDiscordPayload(makePayload()) as {
      embeds: Array<{ title: string; fields: Array<{ name: string }> }>
    }
    expect(embed.embeds[0]?.title).toBe('Scan Complete')
    expect(embed.embeds[0]?.fields.map((f) => f.name)).toEqual(['Discovered', 'Added', 'Failed'])
  })

  it('builds a Digest embed for digest', () => {
    const payload: WebhookPayload = {
      event: 'digest',
      window: 'week',
      stats: { discovered: 12, added: 4, runs: 7 },
      message: 'Digest for the past week.',
      timestamp: '2025-01-01T00:00:00.000Z',
    }
    const embed = formatDiscordPayload(payload) as {
      embeds: Array<{ title: string; description: string; fields: Array<{ name: string }> }>
    }
    expect(embed.embeds[0]?.title).toBe('Digest')
    expect(embed.embeds[0]?.description).toBe(payload.message)
    expect(embed.embeds[0]?.fields.map((f) => f.name)).toEqual(['Discovered', 'Added', 'Runs'])
  })
})
