// @vitest-environment node
import * as http from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHttpClient, HttpError, redactUrlForLog } from '@/core/clients/http'

let server: http.Server
let baseUrl: string

beforeAll(async () => {
  server = http.createServer((_req, res) => {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('not found')
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })

  const addr = server.address() as { port: number }
  baseUrl = `http://127.0.0.1:${addr.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()))
  })
})

describe('query redaction', () => {
  it('redacts sensitive query params from URL strings', () => {
    const url =
      'https://ws.audioscrobbler.com/2.0/?method=user.getTopArtists&api_key=secret&apikey=other&key=third&token=abc123&secret=hidden&password=swordfish&user=test&genre=indie'

    const redacted = redactUrlForLog(url)

    expect(redacted).toContain('method=user.getTopArtists')
    expect(redacted).toContain('user=test')
    expect(redacted).toContain('genre=indie')
    expect(redacted).toContain('api_key=%5BREDACTED%5D')
    expect(redacted).toContain('apikey=%5BREDACTED%5D')
    expect(redacted).toContain('key=%5BREDACTED%5D')
    expect(redacted).toContain('token=%5BREDACTED%5D')
    expect(redacted).toContain('secret=%5BREDACTED%5D')
    expect(redacted).toContain('password=%5BREDACTED%5D')
    expect(redacted).not.toContain('api_key=secret')
    expect(redacted).not.toContain('apikey=other')
    expect(redacted).not.toContain('key=third')
    expect(redacted).not.toContain('abc123')
  })

  it('redacts sensitive query params from createHttpClient failures', async () => {
    const client = createHttpClient({ baseUrl })

    try {
      await client.get(
        '/?api_key=secret&apikey=other&key=third&token=fourth&secret=fifth&password=sixth&artist=Radiohead',
      )
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError)
      const error = err as HttpError
      expect(error.message).toContain('artist=Radiohead')
      expect(error.message).toContain('api_key=%5BREDACTED%5D')
      expect(error.message).not.toContain('api_key=secret')
      expect(error.message).not.toContain('apikey=other')
      expect(error.message).not.toContain('key=third')
      expect(error.message).not.toContain('token=fourth')
      expect(error.message).not.toContain('secret=fifth')
      expect(error.message).not.toContain('password=sixth')
      expect(error.url).toContain('artist=Radiohead')
      expect(error.url).not.toContain('api_key=secret')
    }
  })
})
