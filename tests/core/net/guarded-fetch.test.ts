// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BlockedTargetError, type GuardedInit, guardedFetch } from '@/core/net/guarded-fetch'

const lookupMock = vi.hoisted(() => vi.fn())
vi.mock('node:dns/promises', () => ({ lookup: lookupMock }))

const DNS: Record<string, string> = {
  'example.com': '93.184.216.34',
  'cdn.example.net': '203.0.114.7',
  'internal.example.com': '10.0.0.1',
}

const fetchMock = vi.fn(async (_url: string, _init: GuardedInit) => new Response('ok'))

beforeEach(() => {
  lookupMock.mockReset()
  lookupMock.mockImplementation(async (host: string) => ({ address: DNS[host] ?? host, family: 4 }))
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => new Response('ok'))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

async function reasonOf(promise: Promise<unknown>): Promise<string> {
  const err = await promise.catch((e: unknown) => e)
  expect(err).toBeInstanceOf(BlockedTargetError)
  return (err as BlockedTargetError).reason
}

describe('guardedFetch', () => {
  it.each([
    ['RFC 1918', '10.0.0.5'],
    ['loopback', '127.0.0.1'],
    ['cloud metadata', '169.254.169.254'],
    ['IPv6 metadata', 'fd00:ec2::254'],
    ['CGNAT', '100.64.0.1'],
    ['IPv4-mapped loopback', '::ffff:127.0.0.1'],
    ['IPv4-mapped metadata (hex)', '::ffff:a9fe:a9fe'],
  ])('blocks a hostname resolving to %s', async (_label, address) => {
    lookupMock.mockResolvedValue({ address, family: address.includes(':') ? 6 : 4 })
    expect(await reasonOf(guardedFetch('https://rebind.example/x'))).toBe('blocked_ip')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    'http://localhost/x',
    'http://169.254.169.254/latest/meta-data',
    'http://[::ffff:10.0.0.1]/x',
    'http://[::1]/x',
  ])('blocks literal private host %s before resolving', async (url) => {
    expect(await reasonOf(guardedFetch(url))).toBe('blocked_host')
    expect(lookupMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects non-http schemes', async () => {
    expect(await reasonOf(guardedFetch('file:///etc/passwd'))).toBe('unsupported_protocol')
  })

  it('pins the resolved IP, keeps Host and SNI, and never lets fetch follow redirects', async () => {
    await guardedFetch('https://example.com/a?b=1', { headers: { Accept: 'text/html' } })

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://93.184.216.34/a?b=1')
    const headers = new Headers(init?.headers)
    expect(headers.get('host')).toBe('example.com')
    expect(headers.get('accept')).toBe('text/html')
    expect(init?.tls?.serverName).toBe('example.com')
    expect(init?.redirect).toBe('manual')
  })

  it('returns a redirect unfollowed by default', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'https://cdn.example.net/' } }),
    )
    const res = await guardedFetch('https://example.com/')
    expect(res.status).toBe(302)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('re-resolves and re-checks every redirect hop', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'http://internal.example.com/' } }),
    )
    const result = guardedFetch('https://example.com/', {}, { maxRedirects: 3 })
    expect(await reasonOf(result)).toBe('blocked_ip')
    expect(lookupMock).toHaveBeenLastCalledWith('internal.example.com')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('follows a public redirect: 303 becomes GET and cross-origin drops credentials', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 303, headers: { location: 'https://cdn.example.net/done' } }),
    )
    const res = await guardedFetch(
      'https://example.com/start',
      { method: 'POST', body: '{}', headers: { Authorization: 'Bearer t', 'X-Keep': '1' } },
      { maxRedirects: 3 },
    )
    expect(await res.text()).toBe('ok')
    const [url, init] = fetchMock.mock.calls[1] ?? []
    expect(url).toBe('https://203.0.114.7/done')
    expect(init?.method).toBe('GET')
    expect(init?.body).toBeUndefined()
    const headers = new Headers(init?.headers)
    expect(headers.get('authorization')).toBeNull()
    expect(headers.get('x-keep')).toBe('1')
    expect(headers.get('host')).toBe('cdn.example.net')
    expect(init?.tls?.serverName).toBe('cdn.example.net')
  })

  it('stops after maxRedirects hops', async () => {
    fetchMock.mockImplementation(
      async () => new Response(null, { status: 307, headers: { location: '/again' } }),
    )
    const result = guardedFetch('https://example.com/', {}, { maxRedirects: 2 })
    expect(await reasonOf(result)).toBe('too_many_redirects')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  describe("'lan' policy", () => {
    it('allows RFC 1918 hosts', async () => {
      await guardedFetch('http://192.168.1.5/hook', {}, { policy: 'lan' })
      lookupMock.mockResolvedValueOnce({ address: '10.1.2.3', family: 4 })
      await guardedFetch('http://ntfy.home.example/hook', {}, { policy: 'lan' })
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it.each([['127.0.0.1'], ['169.254.169.254'], ['100.64.0.1'], ['::ffff:127.0.0.1']])(
      'still blocks %s',
      async (address) => {
        lookupMock.mockResolvedValue({ address, family: 4 })
        expect(await reasonOf(guardedFetch('http://x.example/', {}, { policy: 'lan' }))).toBe(
          'blocked_ip',
        )
        expect(
          await reasonOf(
            guardedFetch(
              `http://${address.includes(':') ? `[${address}]` : address}/`,
              {},
              { policy: 'lan' },
            ),
          ),
        ).toBe('blocked_host')
        expect(fetchMock).not.toHaveBeenCalled()
      },
    )
  })
})
