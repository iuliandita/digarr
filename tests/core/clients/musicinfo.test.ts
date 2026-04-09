// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { lookupMock, fetchMock } = vi.hoisted(() => ({
  lookupMock: vi.fn(async () => ({ address: '93.184.216.34', family: 4 })),
  fetchMock: vi.fn(),
}))

vi.mock('node:dns/promises', () => ({
  lookup: lookupMock,
}))
vi.stubGlobal('fetch', fetchMock)

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  fetchMock.mockReset()
  lookupMock.mockReset()
  lookupMock.mockResolvedValue({ address: '93.184.216.34', family: 4 })
})

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

describe('createMusicinfoClient', () => {
  it('returns images from SkyHook-shaped response', async () => {
    fetchMock.mockResolvedValueOnce(
      ok({
        images: [
          { coverType: 'poster', remoteUrl: 'https://example.com/poster.jpg' },
          { coverType: 'clearlogo', remoteUrl: 'https://example.com/logo.png' },
          { coverType: 'fanart', remoteUrl: 'https://example.com/fanart.jpg' },
        ],
      }),
    )
    const { createMusicinfoClient } = await import('@/core/clients/musicinfo')
    const client = createMusicinfoClient('https://musicinfo.example')
    const result = await client.lookupArtistImages('mbid-found')
    expect(result.url).toBe('https://example.com/poster.jpg')
    expect(result.logoUrl).toBe('https://example.com/logo.png')
  })

  it('returns undefined for empty images', async () => {
    fetchMock.mockResolvedValueOnce(ok({ images: [] }))
    const { createMusicinfoClient } = await import('@/core/clients/musicinfo')
    const client = createMusicinfoClient('https://musicinfo.example')
    const result = await client.lookupArtistImages('mbid-empty')
    expect(result.url).toBeUndefined()
    expect(result.logoUrl).toBeUndefined()
  })

  it('returns undefined on server error', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Internal error', { status: 500 }))
    const { createMusicinfoClient } = await import('@/core/clients/musicinfo')
    const client = createMusicinfoClient('https://musicinfo.example')
    const result = await client.lookupArtistImages('mbid-error')
    expect(result.url).toBeUndefined()
    expect(result.logoUrl).toBeUndefined()
  })

  it('blocks redirects when using a user-configurable fallback host', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: '/' } }))

    const { createMusicinfoClient } = await import('@/core/clients/musicinfo')
    const client = createMusicinfoClient('https://musicinfo.example')
    const result = await client.lookupArtistImages('mbid-redirect')

    expect(result.url).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledOnce()
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.redirect).toBe('manual')
  })

  it('rejects private fallback URLs before making a request', async () => {
    const { createMusicinfoClient } = await import('@/core/clients/musicinfo')
    const client = createMusicinfoClient('http://127.0.0.1:8787')
    const result = await client.lookupArtistImages('mbid-private')

    expect(result.url).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
