// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHttpClient } from '@/core/clients/http'

const lookupMock = vi.hoisted(() => vi.fn())

vi.mock('node:dns/promises', () => ({
  lookup: lookupMock,
}))

type CapturedFetchArgs = { url: string; init: RequestInit & { tls?: TlsOptions } }
type TlsOptions = { serverName?: string; rejectUnauthorized?: boolean }

let captured: CapturedFetchArgs | null

beforeEach(() => {
  lookupMock.mockReset()
  captured = null
  vi.stubGlobal('fetch', (url: string | URL, init: RequestInit) => {
    captured = { url: String(url), init: init as CapturedFetchArgs['init'] }
    return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createHttpClient + publicIpOnly DNS rebinding defence', () => {
  it('pins the resolved IP and sets the Host header for HTTP', async () => {
    lookupMock.mockResolvedValue({ address: '93.184.216.34', family: 4 })
    const client = createHttpClient({ baseUrl: 'http://example.com', publicIpOnly: true })

    await client.get('/healthcheck')

    expect(captured).not.toBeNull()
    expect(captured?.url).toBe('http://93.184.216.34/healthcheck')
    const headers = new Headers(captured?.init.headers)
    expect(headers.get('host')).toBe('example.com')
    // HTTP requests do not need tls.serverName; the http.ts implementation should not
    // bother adding a tls block at all when the protocol is plain HTTP.
    expect(captured?.init.tls).toBeUndefined()
  })

  it('pins the resolved IP, sets Host, and preserves SNI hostname for HTTPS', async () => {
    lookupMock.mockResolvedValue({ address: '93.184.216.34', family: 4 })
    const client = createHttpClient({ baseUrl: 'https://example.com', publicIpOnly: true })

    await client.get('/healthcheck')

    expect(captured?.url).toBe('https://93.184.216.34/healthcheck')
    const headers = new Headers(captured?.init.headers)
    expect(headers.get('host')).toBe('example.com')
    expect(captured?.init.tls?.serverName).toBe('example.com')
  })

  it('pins public IPv6 DNS results with bracketed URL literals', async () => {
    lookupMock.mockResolvedValue({ address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 })
    const client = createHttpClient({ baseUrl: 'https://example.com', publicIpOnly: true })

    await client.get('/healthcheck')

    expect(captured?.url).toBe('https://[2606:2800:220:1:248:1893:25c8:1946]/healthcheck')
    const headers = new Headers(captured?.init.headers)
    expect(headers.get('host')).toBe('example.com')
    expect(captured?.init.tls?.serverName).toBe('example.com')
  })

  it('rejects when the URL resolves to a private IP (rebinding to LAN)', async () => {
    lookupMock.mockResolvedValue({ address: '10.0.0.5', family: 4 })
    const client = createHttpClient({
      baseUrl: 'https://intranet.attacker.example',
      publicIpOnly: true,
      retries: 0,
    })

    await expect(client.get('/secret')).rejects.toThrow(/private/i)
  })

  it('rejects when the URL points at a literal private IP up front', async () => {
    const client = createHttpClient({
      baseUrl: 'https://10.0.0.5',
      publicIpOnly: true,
      retries: 0,
    })

    await expect(client.get('/secret')).rejects.toThrow()
    // The pre-DNS isPrivateUrl() check should short-circuit before we hit the resolver.
    expect(lookupMock).not.toHaveBeenCalled()
  })

  it('combines tls.serverName with skipTlsVerify when both are requested', async () => {
    lookupMock.mockResolvedValue({ address: '93.184.216.34', family: 4 })
    const client = createHttpClient({
      baseUrl: 'https://example.com',
      publicIpOnly: true,
      skipTlsVerify: true,
    })

    await client.get('/healthcheck')

    expect(captured?.init.tls?.serverName).toBe('example.com')
    expect(captured?.init.tls?.rejectUnauthorized).toBe(false)
  })

  it('does not set Host or tls when the resolved IP equals the original hostname', async () => {
    lookupMock.mockResolvedValue({ address: '93.184.216.34', family: 4 })
    const client = createHttpClient({ baseUrl: 'https://93.184.216.34', publicIpOnly: true })

    await client.get('/path')

    const headers = new Headers(captured?.init.headers)
    expect(headers.get('host')).toBeNull()
    expect(captured?.init.tls).toBeUndefined()
  })
})
