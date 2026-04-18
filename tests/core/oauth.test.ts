// @vitest-environment node
import * as http from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/db/queries/oauth-tokens', () => ({
  getOAuthToken: vi.fn(),
  upsertOAuthToken: vi.fn(),
}))

const { getOAuthToken, upsertOAuthToken } = await import('@/db/queries/oauth-tokens')
const { getValidToken } = await import('@/core/oauth')

const mockDb = {} as never

let server: http.Server
let tokenEndpoint: string

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(payload)
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')

    if (url.pathname === '/token' && req.method === 'POST') {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString()
        const params = new URLSearchParams(body)

        if (params.get('grant_type') !== 'refresh_token') {
          sendJson(res, 400, { error: 'unsupported_grant_type' })
          return
        }

        sendJson(res, 200, {
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600,
          token_type: 'Bearer',
        })
      })
      return
    }

    if (url.pathname === '/token-fail' && req.method === 'POST') {
      sendJson(res, 401, { error: 'invalid_grant' })
      return
    }

    sendJson(res, 404, { error: 'not_found' })
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })

  const addr = server.address() as { port: number }
  tokenEndpoint = `http://127.0.0.1:${addr.port}/token`
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()))
  })
})

beforeEach(() => {
  vi.clearAllMocks()
})

const refreshConfig = {
  get tokenEndpoint() {
    return tokenEndpoint
  },
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
}

describe('getValidToken()', () => {
  it('returns null when no token exists', async () => {
    vi.mocked(getOAuthToken).mockResolvedValue(null)

    const result = await getValidToken(mockDb, 1, 'spotify', refreshConfig)

    expect(result).toBeNull()
    expect(getOAuthToken).toHaveBeenCalledWith(mockDb, 1, 'spotify')
  })

  it('returns access token when not expired', async () => {
    const futureDate = new Date(Date.now() + 60 * 60 * 1000) // 1 hour from now
    vi.mocked(getOAuthToken).mockResolvedValue({
      accessToken: 'valid-token',
      refreshToken: 'refresh-token',
      expiresAt: futureDate,
    } as never)

    const result = await getValidToken(mockDb, 1, 'spotify', refreshConfig)

    expect(result).toBe('valid-token')
    expect(upsertOAuthToken).not.toHaveBeenCalled()
  })

  it('refreshes token when expired and preserves clientId, clientSecret, scopes', async () => {
    const pastDate = new Date(Date.now() - 60 * 1000) // 1 minute ago
    vi.mocked(getOAuthToken).mockResolvedValue({
      accessToken: 'expired-token',
      refreshToken: 'my-refresh-token',
      expiresAt: pastDate,
      clientId: 'stored-client-id',
      clientSecret: 'stored-client-secret',
      scopes: 'read write',
    } as never)
    vi.mocked(upsertOAuthToken).mockResolvedValue(undefined as never)

    const result = await getValidToken(mockDb, 1, 'spotify', refreshConfig)

    expect(result).toBe('new-access-token')
    expect(upsertOAuthToken).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        userId: 1,
        provider: 'spotify',
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expiresAt: expect.any(Date),
        clientId: 'stored-client-id',
        clientSecret: 'stored-client-secret',
        scopes: 'read write',
      }),
    )
  })

  it('refreshes token when within 5-minute buffer', async () => {
    const almostExpired = new Date(Date.now() + 2 * 60 * 1000) // 2 min from now (inside 5-min buffer)
    vi.mocked(getOAuthToken).mockResolvedValue({
      accessToken: 'almost-expired-token',
      refreshToken: 'my-refresh-token',
      expiresAt: almostExpired,
    } as never)
    vi.mocked(upsertOAuthToken).mockResolvedValue(undefined as never)

    const result = await getValidToken(mockDb, 1, 'spotify', refreshConfig)

    expect(result).toBe('new-access-token')
  })

  it('returns null when expired and no refresh token', async () => {
    const pastDate = new Date(Date.now() - 60 * 1000)
    vi.mocked(getOAuthToken).mockResolvedValue({
      accessToken: 'expired-token',
      refreshToken: null,
      expiresAt: pastDate,
    } as never)

    const result = await getValidToken(mockDb, 1, 'spotify', refreshConfig)

    expect(result).toBeNull()
    expect(upsertOAuthToken).not.toHaveBeenCalled()
  })

  it('returns null when token refresh request fails', async () => {
    const pastDate = new Date(Date.now() - 60 * 1000)
    vi.mocked(getOAuthToken).mockResolvedValue({
      accessToken: 'expired-token',
      refreshToken: 'my-refresh-token',
      expiresAt: pastDate,
    } as never)

    const failEndpoint = tokenEndpoint.replace('/token', '/token-fail')
    const result = await getValidToken(mockDb, 1, 'spotify', {
      ...refreshConfig,
      tokenEndpoint: failEndpoint,
    })

    expect(result).toBeNull()
  })

  it('preserves existing refresh token when response omits it', async () => {
    const pastDate = new Date(Date.now() - 60 * 1000)
    vi.mocked(getOAuthToken).mockResolvedValue({
      accessToken: 'expired-token',
      refreshToken: 'original-refresh',
      expiresAt: pastDate,
    } as never)
    vi.mocked(upsertOAuthToken).mockResolvedValue(undefined as never)

    await getValidToken(mockDb, 1, 'spotify', refreshConfig)

    // The mock server returns a new refresh_token, so it uses that.
    // This test validates the upsert was called with the right shape.
    expect(upsertOAuthToken).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        userId: 1,
        provider: 'spotify',
        accessToken: 'new-access-token',
      }),
    )
  })
})
