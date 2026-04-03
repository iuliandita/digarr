// @vitest-environment node
import * as http from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createMusicinfoClient } from '@/core/clients/musicinfo'

let server: http.Server
let baseUrl: string

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? ''
    if (url.includes('/api/v0.4/artist/mbid-found')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          images: [
            { coverType: 'poster', remoteUrl: 'https://example.com/poster.jpg' },
            { coverType: 'clearlogo', remoteUrl: 'https://example.com/logo.png' },
            { coverType: 'fanart', remoteUrl: 'https://example.com/fanart.jpg' },
          ],
        }),
      )
      return
    }
    if (url.includes('/api/v0.4/artist/mbid-empty')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ images: [] }))
      return
    }
    if (url.includes('/api/v0.4/artist/mbid-error')) {
      res.writeHead(500, { 'Content-Type': 'text/plain' })
      res.end('Internal error')
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

describe('createMusicinfoClient', () => {
  it('returns images from SkyHook-shaped response', async () => {
    const client = createMusicinfoClient(baseUrl)
    const result = await client.lookupArtistImages('mbid-found')
    expect(result.url).toBe('https://example.com/poster.jpg')
    expect(result.logoUrl).toBe('https://example.com/logo.png')
  })
  it('returns undefined for empty images', async () => {
    const client = createMusicinfoClient(baseUrl)
    const result = await client.lookupArtistImages('mbid-empty')
    expect(result.url).toBeUndefined()
    expect(result.logoUrl).toBeUndefined()
  })
  it('returns undefined on server error', async () => {
    const client = createMusicinfoClient(baseUrl)
    const result = await client.lookupArtistImages('mbid-error')
    expect(result.url).toBeUndefined()
    expect(result.logoUrl).toBeUndefined()
  })
})
