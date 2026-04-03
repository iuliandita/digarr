// @vitest-environment node
import * as http from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createFanartClient } from '@/core/clients/fanart'

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
