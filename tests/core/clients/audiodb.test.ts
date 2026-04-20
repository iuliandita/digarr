// @vitest-environment node
import * as http from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createAudiodbClient, RateLimitedError } from '@/core/clients/audiodb'

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
    if (url.includes('/artist-mb.php?i=mbid-hit')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          artists: [
            {
              strArtistThumb: 'https://img.theaudiodb.com/thumb.jpg',
              strArtistLogo: 'https://img.theaudiodb.com/logo.png',
            },
          ],
        }),
      )
      return
    }
    if (url.includes('/artist-mb.php?i=mbid-null')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ artists: null }))
      return
    }
    if (url.includes('/artist-mb.php?i=mbid-429')) {
      res.writeHead(429, { 'Content-Type': 'application/json' })
      res.end('{}')
      return
    }
    if (url.includes('/search.php?s=Boards')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          artists: [
            {
              strArtist: 'Boards of Canada',
              strArtistThumb: 'https://img.theaudiodb.com/boc.jpg',
            },
          ],
        }),
      )
      return
    }
    if (url.includes('/search.php?s=Ambiguous')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ artists: [{ strArtist: 'X' }, { strArtist: 'X' }] }))
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

describe('AudioDB client', () => {
  it('returns image + logo on MBID hit', async () => {
    const client = createAudiodbClient({
      apiKey: 'testkey',
      tryConsume: async () => true,
      baseUrl,
    })
    const result = await client.getArtistImages('mbid-hit')
    expect(result.url).toBe('https://img.theaudiodb.com/thumb.jpg')
    expect(result.logoUrl).toBe('https://img.theaudiodb.com/logo.png')
  })

  it('returns empty object when artists array is null', async () => {
    const client = createAudiodbClient({
      apiKey: 'testkey',
      tryConsume: async () => true,
      baseUrl,
    })
    expect(await client.getArtistImages('mbid-null')).toEqual({})
  })

  it('throws RateLimitedError on 429', async () => {
    const client = createAudiodbClient({
      apiKey: 'testkey',
      tryConsume: async () => true,
      baseUrl,
    })
    await expect(client.getArtistImages('mbid-429')).rejects.toBeInstanceOf(RateLimitedError)
  })

  it('name search returns result on single exact match', async () => {
    const client = createAudiodbClient({
      apiKey: 'testkey',
      tryConsume: async () => true,
      baseUrl,
    })
    const result = await client.searchArtistByName('Boards')
    expect(result.url).toBe('https://img.theaudiodb.com/boc.jpg')
  })

  it('name search returns empty on ambiguous matches', async () => {
    const client = createAudiodbClient({
      apiKey: 'testkey',
      tryConsume: async () => true,
      baseUrl,
    })
    expect(await client.searchArtistByName('Ambiguous')).toEqual({})
  })

  it('refuses to make HTTP call when rate limiter denies', async () => {
    const tryConsume = vi.fn(async () => false)
    const client = createAudiodbClient({ apiKey: 'testkey', tryConsume, baseUrl })
    await expect(client.getArtistImages('mbid-hit')).rejects.toBeInstanceOf(RateLimitedError)
    expect(tryConsume).toHaveBeenCalled()
  })
})
