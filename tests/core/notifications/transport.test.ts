// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { post } from '@/core/notifications/transport'

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async (host: string) => ({
    address: host === 'example.com' ? '93.184.216.34' : host,
    family: 4,
  })),
}))

const okFetch = vi.fn(
  async (_url: string, _init?: RequestInit) => new Response(null, { status: 204 }),
)

describe('post (SSRF transport)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', okFetch)
    okFetch.mockClear()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('rejects non-http URLs', async () => {
    const r = await post('ftp://x/y', { a: 1 })
    expect(r.ok).toBe(false)
    expect(okFetch).not.toHaveBeenCalled()
  })

  it('rejects RFC1918 targets by default', async () => {
    const r = await post('http://192.168.1.5/hook', { a: 1 })
    expect(r.ok).toBe(false)
    expect(okFetch).not.toHaveBeenCalled()
  })

  it('allows RFC1918 when allowPrivate is set', async () => {
    const r = await post('http://192.168.1.5/hook', { a: 1 }, { allowPrivate: true })
    expect(r.ok).toBe(true)
    expect(okFetch).toHaveBeenCalledOnce()
  })

  it('blocks metadata even when allowPrivate is set', async () => {
    const r = await post('http://169.254.169.254/latest', { a: 1 }, { allowPrivate: true })
    expect(r.ok).toBe(false)
    expect(okFetch).not.toHaveBeenCalled()
  })

  it('blocks literal localhost even with allowPrivate', async () => {
    const r = await post('http://localhost/x', {}, { allowPrivate: true })
    expect(r.ok).toBe(false)
    expect(okFetch).not.toHaveBeenCalled()
  })

  it('posts JSON to a public host', async () => {
    const r = await post('https://example.com/hook', { hello: 'world' })
    expect(r.ok).toBe(true)
    const [fetchUrl, init] = okFetch.mock.calls[0] as [string, RequestInit]
    if (!init) throw new Error('fetch was not called')
    expect(init.method).toBe('POST')
    expect(init.redirect).toBe('manual')
    expect(JSON.parse(init.body as string)).toEqual({ hello: 'world' })
    // Anti-rebinding: fetch targets the pinned resolved IP, not the hostname.
    expect(fetchUrl).toContain('93.184.216.34')
    expect(fetchUrl).not.toContain('example.com')
    expect((init.headers as Record<string, string>).Host).toBe('example.com')
  })

  it('sends rawBody as-is when provided', async () => {
    await post('https://example.com/hook', undefined, { rawBody: 'plain text' })
    const [, init] = okFetch.mock.calls[0] as [string, RequestInit]
    if (!init) throw new Error('fetch was not called')
    expect(init.body).toBe('plain text')
  })
})
