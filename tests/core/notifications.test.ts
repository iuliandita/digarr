// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isPrivateUrl, sendWebhook, type WebhookPayload } from '@/core/notifications'

// Mock DNS lookup to return a public IP for test domains
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn().mockResolvedValue({ address: '93.184.216.34', family: 4 }),
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

describe('isPrivateUrl', () => {
  it('rejects 127.x.x.x', () => {
    expect(isPrivateUrl('http://127.0.0.1/hook')).toBe(true)
    expect(isPrivateUrl('http://127.1.2.3:8080/hook')).toBe(true)
  })

  it('rejects 10.x.x.x', () => {
    expect(isPrivateUrl('http://10.0.0.1/hook')).toBe(true)
    expect(isPrivateUrl('http://10.255.255.255/hook')).toBe(true)
  })

  it('rejects 172.16-31.x.x', () => {
    expect(isPrivateUrl('http://172.16.0.1/hook')).toBe(true)
    expect(isPrivateUrl('http://172.31.255.255/hook')).toBe(true)
  })

  it('allows 172.32.x.x', () => {
    expect(isPrivateUrl('http://172.32.0.1/hook')).toBe(false)
  })

  it('rejects 192.168.x.x', () => {
    expect(isPrivateUrl('http://192.168.1.1/hook')).toBe(true)
  })

  it('rejects localhost', () => {
    expect(isPrivateUrl('http://localhost/hook')).toBe(true)
    expect(isPrivateUrl('http://localhost:3000/hook')).toBe(true)
  })

  it('rejects IPv6 loopback', () => {
    expect(isPrivateUrl('http://[::1]/hook')).toBe(true)
  })

  it('rejects IPv4-mapped IPv6 loopback and RFC1918 addresses', () => {
    expect(isPrivateUrl('http://[::ffff:127.0.0.1]/hook')).toBe(true)
    expect(isPrivateUrl('http://[::ffff:10.0.0.5]/hook')).toBe(true)
  })

  it('rejects fc/fd IPv6 private', () => {
    expect(isPrivateUrl('http://[fc00::1]/hook')).toBe(true)
    expect(isPrivateUrl('http://[fd12::1]/hook')).toBe(true)
  })

  it('rejects invalid URLs', () => {
    expect(isPrivateUrl('not-a-url')).toBe(true)
    expect(isPrivateUrl('')).toBe(true)
  })

  it('allows public URLs', () => {
    expect(isPrivateUrl('https://hooks.slack.com/services/xxx')).toBe(false)
    expect(isPrivateUrl('https://discord.com/api/webhooks/123/abc')).toBe(false)
    expect(isPrivateUrl('https://ntfy.sh/mytopic')).toBe(false)
  })
})

describe('sendWebhook', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let consoleSpy: ReturnType<typeof vi.spyOn>

  function requireCall<T>(value: T | undefined, message: string): T {
    if (value === undefined) {
      throw new Error(message)
    }
    return value
  }

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('sends POST with correct JSON payload and Content-Type', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 })
    const payload = makePayload()

    await sendWebhook('https://hooks.example.com/webhook', payload)

    expect(fetchMock).toHaveBeenCalledOnce()
    const call = requireCall(fetchMock.mock.calls[0], 'Expected webhook fetch call')
    const [url, init] = call
    expect(url).toBe('https://93.184.216.34/webhook')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(init.headers.Host).toBe('hooks.example.com')
    expect(init.tls).toEqual(expect.objectContaining({ serverName: 'hooks.example.com' }))
    expect(JSON.parse(init.body)).toEqual(payload)
  })

  it('handles non-200 responses gracefully (logs, does not throw)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 })

    await sendWebhook('https://hooks.example.com/webhook', makePayload())

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('HTTP 500'))
  })

  it('handles network errors gracefully', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))

    await sendWebhook('https://hooks.example.com/webhook', makePayload())

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('failed'), expect.any(Error))
  })

  it('rejects non-http(s) URLs', async () => {
    await sendWebhook('ftp://example.com/hook', makePayload())

    expect(fetchMock).not.toHaveBeenCalled()
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('http:// or https://'))
  })

  it('rejects private IP URLs', async () => {
    await sendWebhook('http://192.168.1.1/hook', makePayload())

    expect(fetchMock).not.toHaveBeenCalled()
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('private/internal'))
  })

  it('rejects localhost URLs', async () => {
    await sendWebhook('http://localhost:9999/hook', makePayload())

    expect(fetchMock).not.toHaveBeenCalled()
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('private/internal'))
  })

  it('rejects 127.0.0.1 URLs', async () => {
    await sendWebhook('http://127.0.0.1:3000/hook', makePayload())

    expect(fetchMock).not.toHaveBeenCalled()
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('private/internal'))
  })

  it('aborts after timeout', async () => {
    // Simulate a fetch that never resolves until abort
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        })
      })
    })

    // The real timeout is 10s - we can't wait that long in tests.
    // Instead, verify the signal is passed to fetch.
    const promise = sendWebhook('https://hooks.example.com/webhook', makePayload())

    // Yield to let async DNS lookup resolve before checking fetch.
    // setImmediate queues past the microtask + macrotask queue — cheaper
    // than burning 10ms of real wall time on every run.
    await new Promise<void>((r) => setImmediate(r))

    // Verify signal was passed
    expect(fetchMock).toHaveBeenCalledOnce()
    const call = requireCall(fetchMock.mock.calls[0], 'Expected webhook fetch call')
    const [, init] = call
    expect(init.signal).toBeInstanceOf(AbortSignal)

    // Manually abort to let the promise resolve
    init.signal.dispatchEvent(new Event('abort'))
    await promise

    expect(consoleSpy).toHaveBeenCalled()
  })
})
