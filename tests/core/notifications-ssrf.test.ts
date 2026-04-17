// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendWebhook, type WebhookPayload } from '@/core/notifications'

const lookupMock = vi.hoisted(() => vi.fn())

vi.mock('node:dns/promises', () => ({
  lookup: lookupMock,
}))

function makePayload(overrides?: Partial<WebhookPayload>): WebhookPayload {
  return {
    event: 'batch_complete',
    batchId: 42,
    stats: { discovered: 10, added: 10, failed: 0 },
    message: 'Scan complete: 10 new recommendations found.',
    timestamp: '2025-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('sendWebhook HTTPS SSRF hardening', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let consoleSpy: ReturnType<typeof vi.spyOn>

  function requireCall<T>(value: T | undefined, message: string): T {
    if (value === undefined) {
      throw new Error(message)
    }

    return value
  }

  beforeEach(() => {
    lookupMock.mockReset()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('rejects HTTPS webhook targets that resolve to a private IP', async () => {
    lookupMock.mockResolvedValueOnce({ address: '10.0.0.5', family: 4 })

    await sendWebhook('https://hooks.example.com/webhook', makePayload())

    expect(fetchMock).not.toHaveBeenCalled()
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('private/internal IP address'))
  })

  it('pins HTTPS webhooks to the resolved IP while preserving SNI', async () => {
    lookupMock.mockResolvedValueOnce({ address: '93.184.216.34', family: 4 })
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 })

    await sendWebhook('https://hooks.example.com/webhook', makePayload())

    expect(fetchMock).toHaveBeenCalledOnce()
    const call = requireCall(fetchMock.mock.calls[0], 'Expected webhook fetch call')
    const [url, init] = call
    expect(String(url)).toBe('https://93.184.216.34/webhook')
    expect(init.headers).toEqual(
      expect.objectContaining({
        Host: 'hooks.example.com',
        'Content-Type': 'application/json',
      }),
    )
    expect(init.tls).toEqual(expect.objectContaining({ serverName: 'hooks.example.com' }))
  })

  it('keeps HTTPS public IP literals pinned without forcing SNI', async () => {
    lookupMock.mockResolvedValueOnce({ address: '93.184.216.34', family: 4 })
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 })

    await sendWebhook('https://93.184.216.34/webhook', makePayload())

    expect(fetchMock).toHaveBeenCalledOnce()
    const call = requireCall(fetchMock.mock.calls[0], 'Expected webhook fetch call')
    const [url, init] = call
    expect(String(url)).toBe('https://93.184.216.34/webhook')
    expect(init.tls).toBeUndefined()
  })

  it('normalizes HTTPS IPv6 literals before lookup and keeps SNI disabled', async () => {
    lookupMock.mockResolvedValueOnce({ address: '2001:4860:4860::8888', family: 6 })
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 })

    await sendWebhook('https://[2001:4860:4860::8888]/webhook', makePayload())

    expect(lookupMock).toHaveBeenCalledWith('2001:4860:4860::8888')
    expect(fetchMock).toHaveBeenCalledOnce()
    const call = requireCall(fetchMock.mock.calls[0], 'Expected webhook fetch call')
    const [url, init] = call
    expect(String(url)).toBe('https://[2001:4860:4860::8888]/webhook')
    expect(init.tls).toBeUndefined()
    expect(init.headers).toEqual(
      expect.objectContaining({
        Host: '[2001:4860:4860::8888]',
        'Content-Type': 'application/json',
      }),
    )
  })
})
