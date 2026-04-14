// @vitest-environment node
import * as http from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createFanartClient } from '@/core/clients/fanart'

// The http client is configured with `publicIpOnly: true` for SSRF
// hardening, which rejects loopback/localhost. The test server runs on
// localhost, so mock the URL safety helpers and DNS resolver to let
// the publicIpOnly path through without disabling the production guard.
// Return 127.0.0.1 so the http client's IP-pinning rewrite still points
// at our local test server; combined with the isPrivateIp/isPrivateUrl
// overrides below, the publicIpOnly path accepts the test hostname.
vi.mock('node:dns/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:dns/promises')>()
  return {
    ...actual,
    lookup: vi.fn(async () => ({ address: '127.0.0.1', family: 4 })),
  }
})
vi.mock('@/core/notifications', async () => {
  const actual =
    await vi.importActual<typeof import('@/core/notifications')>('@/core/notifications')
  return {
    ...actual,
    isPrivateUrl: () => false,
    isPrivateIp: () => false,
  }
})

let server: http.Server
let baseUrl: string

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? ''
    if (url.includes('/music/mbid-with-images')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          artistthumb: [{ url: 'https://fanart.tv/thumb/1.jpg', likes: '5' }],
          hdmusiclogo: [{ url: 'https://fanart.tv/logo/1.png', likes: '3' }],
          artistbackground: [{ url: 'https://fanart.tv/bg/1.jpg', likes: '2' }],
        }),
      )
      return
    }
    if (url.includes('/music/mbid-no-images')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({}))
      return
    }
    if (url.includes('/music/mbid-error')) {
      res.writeHead(500, { 'Content-Type': 'text/plain' })
      res.end('Server error')
      return
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise<void>((resolve) => {
    server.listen(0, () => resolve())
  })
  const addr = server.address() as { port: number }
  baseUrl = `http://localhost:${addr.port}`
})

afterAll(() => {
  server.close()
})

describe('createFanartClient', () => {
  it('returns image and logo URLs for an artist with images', async () => {
    const client = createFanartClient('test-key', baseUrl)
    const result = await client.getArtistImages('mbid-with-images')
    expect(result.url).toBe('https://fanart.tv/thumb/1.jpg')
    expect(result.logoUrl).toBe('https://fanart.tv/logo/1.png')
  })

  it('returns undefined URLs for an artist with no images', async () => {
    const client = createFanartClient('test-key', baseUrl)
    const result = await client.getArtistImages('mbid-no-images')
    expect(result.url).toBeUndefined()
    expect(result.logoUrl).toBeUndefined()
  })

  it('returns undefined URLs on server error', async () => {
    const client = createFanartClient('test-key', baseUrl)
    const result = await client.getArtistImages('mbid-error')
    expect(result.url).toBeUndefined()
    expect(result.logoUrl).toBeUndefined()
  })
})
