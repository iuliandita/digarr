// @vitest-environment node
import * as http from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createHttpClient, HttpError } from '@/core/clients/http'

let server: http.Server
let baseUrl: string

// Per-path HTTP call counters tracked by the test server
const serverHits = new Map<string, number>()

function hit(path: string): number {
  const n = (serverHits.get(path) ?? 0) + 1
  serverHits.set(path, n)
  return n
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(payload)
}

function sendText(res: http.ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain' })
  res.end(body)
}

function sendEmpty(res: http.ServerResponse, status: number): void {
  res.writeHead(status)
  res.end()
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString()))
  })
}

beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    const rawUrl = req.url ?? '/'
    const parsed = new URL(rawUrl, 'http://localhost')
    const path = parsed.pathname

    // Slow endpoint for timeout test -- delays 500ms
    if (path === '/slow') {
      await new Promise((r) => setTimeout(r, 500))
      sendJson(res, 200, { ok: true })
      return
    }

    // Flaky endpoint: /flaky/:key?fails=N
    // Fails first N calls on this path, then succeeds
    if (path.startsWith('/flaky/')) {
      const failCount = Number(parsed.searchParams.get('fails') ?? '0')
      const callN = hit(path)
      if (callN <= failCount) {
        sendText(res, 500, 'server error')
      } else {
        sendJson(res, 200, { recovered: true, callN })
      }
      return
    }

    if (path === '/notfound') {
      hit(path)
      sendText(res, 404, 'not found')
      return
    }

    if (path === '/forbidden') {
      hit(path)
      sendText(res, 403, 'forbidden')
      return
    }

    if (path === '/empty') {
      hit(path)
      sendEmpty(res, 204)
      return
    }

    if (path === '/redirect') {
      hit(path)
      res.writeHead(302, { Location: '/redirect-target' })
      res.end()
      return
    }

    if (path === '/redirect-target') {
      hit(path)
      sendJson(res, 200, { redirected: true })
      return
    }

    // Echo request headers as JSON
    if (path === '/headers') {
      sendJson(res, 200, req.headers)
      return
    }

    // POST body echo
    if (path === '/echo' && req.method === 'POST') {
      const raw = await readBody(req)
      const body: unknown = JSON.parse(raw)
      sendJson(res, 200, { received: body })
      return
    }

    // Default 200
    sendJson(res, 200, { hello: 'world' })
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

describe('createHttpClient', () => {
  describe('GET', () => {
    it('returns parsed JSON on 200', async () => {
      const client = createHttpClient({ baseUrl })
      const result = await client.get<{ hello: string }>('/')
      expect(result).toEqual({ hello: 'world' })
    })

    it('sends custom headers', async () => {
      const client = createHttpClient({ baseUrl, headers: { 'x-api-key': 'secret123' } })
      const result = await client.get<Record<string, string>>('/headers')
      expect(result['x-api-key']).toBe('secret123')
    })
  })

  describe('POST', () => {
    it('sends body and returns parsed JSON', async () => {
      const client = createHttpClient({ baseUrl })
      const result = await client.post<{ received: { name: string } }>('/echo', { name: 'test' })
      expect(result.received).toEqual({ name: 'test' })
    })
  })

  describe('4xx errors -- no retry', () => {
    it('throws HttpError on 404', async () => {
      const client = createHttpClient({ baseUrl, retries: 3 })
      await expect(client.get('/notfound')).rejects.toThrow(HttpError)
    })

    it('throws HttpError on 403', async () => {
      const client = createHttpClient({ baseUrl, retries: 3 })
      await expect(client.get('/forbidden')).rejects.toThrow(HttpError)
    })

    it('HttpError carries correct status and url', async () => {
      const client = createHttpClient({ baseUrl })
      try {
        await client.get('/notfound')
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(HttpError)
        const e = err as HttpError
        expect(e.status).toBe(404)
        expect(e.url).toContain('/notfound')
      }
    })

    it('hits the server exactly once on 4xx (no retries)', async () => {
      const before = serverHits.get('/forbidden') ?? 0
      const client = createHttpClient({ baseUrl, retries: 3 })
      await client.get('/forbidden').catch(() => null)
      const after = serverHits.get('/forbidden') ?? 0
      expect(after - before).toBe(1)
    })
  })

  describe('empty responses', () => {
    it('returns undefined for DELETE requests with no body', async () => {
      const client = createHttpClient({ baseUrl })
      await expect(client.delete('/empty')).resolves.toBeUndefined()
    })
  })

  describe('redirect handling', () => {
    it('blocks redirects by default instead of following them', async () => {
      const beforeRedirect = serverHits.get('/redirect') ?? 0
      const beforeTarget = serverHits.get('/redirect-target') ?? 0
      const client = createHttpClient({ baseUrl })

      await expect(client.get('/redirect')).rejects.toThrow(HttpError)

      const afterRedirect = serverHits.get('/redirect') ?? 0
      const afterTarget = serverHits.get('/redirect-target') ?? 0
      expect(afterRedirect - beforeRedirect).toBe(1)
      expect(afterTarget - beforeTarget).toBe(0)
    })
  })

  describe('5xx errors -- retry with exponential backoff', () => {
    it('retries on 500 and succeeds when server recovers', async () => {
      // /flaky/test-recover?fails=2 -- fails first 2 hits, succeeds on 3rd
      const path = '/flaky/test-recover'
      const before = serverHits.get(path) ?? 0
      const client = createHttpClient({ baseUrl, retries: 3 })
      const result = await client.get<{ recovered: boolean; callN: number }>(`${path}?fails=2`)
      expect(result.recovered).toBe(true)
      const after = serverHits.get(path) ?? 0
      expect(after - before).toBe(3) // 2 failures + 1 success
    }, 20_000)

    it('throws after exhausting retries on persistent 5xx', async () => {
      const client = createHttpClient({ baseUrl, retries: 2 })
      await expect(client.get('/flaky/test-exhaust?fails=99')).rejects.toThrow()
    }, 20_000)

    it('makes exactly retries+1 attempts before giving up', async () => {
      const path = '/flaky/test-count'
      const before = serverHits.get(path) ?? 0
      const client = createHttpClient({ baseUrl, retries: 2 })
      await client.get(`${path}?fails=99`).catch(() => null)
      const after = serverHits.get(path) ?? 0
      // retries=2: initial attempt + 2 retries = 3 total
      expect(after - before).toBe(3)
    }, 20_000)
  })

  describe('timeout', () => {
    it('aborts and throws when request exceeds timeout', async () => {
      // /slow takes 500ms, timeout is 100ms
      const client = createHttpClient({ baseUrl, timeout: 100, retries: 0 })
      await expect(client.get('/slow')).rejects.toThrow()
    }, 5_000)
  })

  describe('onRequest callback', () => {
    it('is called with method and full URL', async () => {
      const onRequest = vi.fn()
      const client = createHttpClient({ baseUrl, onRequest })
      await client.get('/')
      expect(onRequest).toHaveBeenCalledOnce()
      expect(onRequest).toHaveBeenCalledWith('GET', `${baseUrl}/`)
    })

    it('is called once per request() invocation regardless of retries', async () => {
      // onRequest fires once at the top of request(), before the retry loop
      const onRequest = vi.fn()
      const client = createHttpClient({ baseUrl, onRequest, retries: 3 })
      await client.get('/flaky/test-onreq?fails=2')
      expect(onRequest).toHaveBeenCalledTimes(1)
    }, 20_000)
  })
})
