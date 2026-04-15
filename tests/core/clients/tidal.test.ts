// @vitest-environment node
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTidalClient } from '@/core/clients/tidal'

let authServer: http.Server
let searchServer: http.Server
let authBaseUrl: string
let searchBaseUrl: string

let tokenRequestCount = 0

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(payload)
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString()))
  })
}

beforeAll(async () => {
  // Auth server: handles POST /token
  authServer = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/token') {
      const body = await readBody(req)
      const params = new URLSearchParams(body)

      if (params.get('client_id') === 'bad-id') {
        sendJson(res, 401, { error: 'invalid_client' })
        return
      }

      tokenRequestCount++
      sendJson(res, 200, {
        access_token: `mock-token-${tokenRequestCount}`,
        token_type: 'Bearer',
        expires_in: 86400,
      })
      return
    }
    res.writeHead(404)
    res.end()
  })

  // Search server: handles TIDAL search endpoint
  searchServer = http.createServer((req, res) => {
    const parsed = new URL(req.url ?? '/', 'http://localhost')

    // Match /v2/searchresults/{query}/relationships/artists
    if (parsed.pathname.includes('/relationships/artists')) {
      const authHeader = req.headers.authorization ?? ''
      if (!authHeader.startsWith('Bearer ')) {
        sendJson(res, 401, { error: 'Unauthorized' })
        return
      }

      sendJson(res, 200, {
        data: [
          {
            id: '42',
            attributes: {
              name: 'Portishead',
              popularity: 78,
              images: [
                { href: 'https://resources.tidal.com/portishead.jpg', meta: { type: 'ARTIST' } },
              ],
              externalLinks: [{ href: 'https://tidal.com/artist/42', meta: { type: 'TIDAL' } }],
            },
          },
          {
            id: '99',
            attributes: {
              name: 'Massive Attack',
              popularity: 85,
              images: [],
              externalLinks: [],
            },
          },
        ],
      })
      return
    }

    res.writeHead(404)
    res.end()
  })

  await Promise.all([
    new Promise<void>((r) => authServer.listen(0, '127.0.0.1', r)),
    new Promise<void>((r) => searchServer.listen(0, '127.0.0.1', r)),
  ])

  const authAddr = authServer.address() as AddressInfo
  const searchAddr = searchServer.address() as AddressInfo
  authBaseUrl = `http://127.0.0.1:${authAddr.port}`
  searchBaseUrl = `http://127.0.0.1:${searchAddr.port}/v2`
})

afterAll(() => {
  authServer.close()
  searchServer.close()
})

describe('createTidalClient', () => {
  describe('auth / token handling', () => {
    it('fetches a token on first search', async () => {
      const before = tokenRequestCount
      const client = createTidalClient({
        clientId: 'test-id',
        clientSecret: 'test-secret',
        tokenUrl: `${authBaseUrl}/token`,
        baseUrl: searchBaseUrl,
      })
      await client.searchArtists('portishead')
      expect(tokenRequestCount).toBe(before + 1)
    })

    it('caches the token and does not re-fetch on second call', async () => {
      const client = createTidalClient({
        clientId: 'test-id',
        clientSecret: 'test-secret',
        tokenUrl: `${authBaseUrl}/token`,
        baseUrl: searchBaseUrl,
      })
      const before = tokenRequestCount
      await client.searchArtists('portishead')
      await client.searchArtists('massive attack')
      // Both calls should use the same token - only 1 fetch after `before`
      expect(tokenRequestCount - before).toBe(1)
    })

    it('returns empty results when auth fails (bad credentials)', async () => {
      const client = createTidalClient({
        clientId: 'bad-id',
        clientSecret: 'bad-secret',
        tokenUrl: `${authBaseUrl}/token`,
        baseUrl: searchBaseUrl,
      })
      const results = await client.searchArtists('portishead')
      expect(results).toEqual([])
    })
  })

  describe('searchArtists(query, limit)', () => {
    it('returns mapped TidalSearchResult array', async () => {
      const client = createTidalClient({
        clientId: 'test-id',
        clientSecret: 'test-secret',
        tokenUrl: `${authBaseUrl}/token`,
        baseUrl: searchBaseUrl,
      })
      const results = await client.searchArtists('portishead')
      expect(results.length).toBeGreaterThan(0)
      expect(results[0]).toMatchObject({
        id: 42,
        name: 'Portishead',
        popularity: 78,
        url: 'https://tidal.com/artist/42',
        imageUrl: 'https://resources.tidal.com/portishead.jpg',
      })
    })

    it('falls back to generated URL when no externalLinks', async () => {
      const client = createTidalClient({
        clientId: 'test-id',
        clientSecret: 'test-secret',
        tokenUrl: `${authBaseUrl}/token`,
        baseUrl: searchBaseUrl,
      })
      const results = await client.searchArtists('massive attack')
      const massiveAttack = results.find((r) => r.name === 'Massive Attack')
      expect(massiveAttack?.url).toBe('https://tidal.com/artist/99')
    })

    it('returns undefined imageUrl when images array is empty', async () => {
      const client = createTidalClient({
        clientId: 'test-id',
        clientSecret: 'test-secret',
        tokenUrl: `${authBaseUrl}/token`,
        baseUrl: searchBaseUrl,
      })
      const results = await client.searchArtists('massive attack')
      const massiveAttack = results.find((r) => r.name === 'Massive Attack')
      expect(massiveAttack?.imageUrl).toBeUndefined()
    })

    it('returns empty array when server is unreachable (resilience)', async () => {
      const client = createTidalClient({
        clientId: 'test-id',
        clientSecret: 'test-secret',
        tokenUrl: `${authBaseUrl}/token`,
        baseUrl: 'http://127.0.0.1:1/v2',
      })
      // Auth succeeds (real auth server), search fails - should not throw
      const results = await client.searchArtists('portishead')
      expect(results).toEqual([])
    })
  })

  describe('testConnection()', () => {
    it('returns success:true with valid credentials', async () => {
      const client = createTidalClient({
        clientId: 'test-id',
        clientSecret: 'test-secret',
        tokenUrl: `${authBaseUrl}/token`,
        baseUrl: searchBaseUrl,
      })
      const result = await client.testConnection()
      expect(result.success).toBe(true)
      expect(typeof result.message).toBe('string')
    })

    it('returns success:false with invalid credentials', async () => {
      const client = createTidalClient({
        clientId: 'bad-id',
        clientSecret: 'bad-secret',
        tokenUrl: `${authBaseUrl}/token`,
        baseUrl: searchBaseUrl,
      })
      const result = await client.testConnection()
      expect(result.success).toBe(false)
      expect(typeof result.message).toBe('string')
    })

    it('returns success:false when auth server is unreachable', async () => {
      const client = createTidalClient({
        clientId: 'test-id',
        clientSecret: 'test-secret',
        tokenUrl: 'http://127.0.0.1:1/token',
        baseUrl: searchBaseUrl,
      })
      const result = await client.testConnection()
      expect(result.success).toBe(false)
    })
  })
})
