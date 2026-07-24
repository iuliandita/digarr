// @vitest-environment node

import { createHash } from 'node:crypto'
import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '@/server/types'

vi.mock('@/db/queries/oauth-tokens', () => ({
  getOAuthToken: vi.fn(),
  upsertOAuthToken: vi.fn(),
  deleteOAuthToken: vi.fn(),
  findPendingOAuthByState: vi.fn(),
}))

const { upsertOAuthToken, findPendingOAuthByState } = await import('@/db/queries/oauth-tokens')
const { oauthRoutes } = await import('@/server/routes/oauth')

const REDIRECT_URI = 'https://example.com/api/v1/auth/oauth/tidal/callback'

function makeDeps(settings: Record<string, unknown> | null = null) {
  return {
    db: {} as never,
    getSettings: vi.fn().mockResolvedValue(settings),
    targetQueries: {
      getTargetsByUser: vi.fn().mockResolvedValue([]),
      createTarget: vi.fn().mockResolvedValue({}),
    },
  }
}

function createApp(deps: ReturnType<typeof makeDeps>, authed = true) {
  const app = new Hono<HonoEnv>()
  app.use('*', async (c, next) => {
    if (authed) c.set('userId', 1)
    return next()
  })
  app.route('/', oauthRoutes(deps as never))
  return app
}

function initiate(deps: ReturnType<typeof makeDeps>, body: Record<string, unknown> = {}) {
  return createApp(deps).request('/api/v1/auth/oauth/tidal/initiate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: '', clientSecret: '', redirectUri: REDIRECT_URI, ...body }),
  })
}

const configuredSettings = { tidalClientId: 'app-id', tidalClientSecret: 'app-secret' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(upsertOAuthToken).mockResolvedValue({} as never)
})

describe('POST /api/v1/auth/oauth/tidal/initiate', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await createApp(makeDeps(configuredSettings), false).request(
      '/api/v1/auth/oauth/tidal/initiate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ redirectUri: REDIRECT_URI }),
      },
    )
    expect(res.status).toBe(401)
  })

  it('returns 400 when the shared TIDAL app is not configured', async () => {
    const res = await initiate(makeDeps(null))
    expect(res.status).toBe(400)
  })

  it('returns an authUrl with an S256 PKCE challenge and the collection.read scope', async () => {
    const res = await initiate(makeDeps(configuredSettings))
    expect(res.status).toBe(200)
    const body = await res.json()
    const url = new URL(body.authUrl)

    expect(url.origin + url.pathname).toBe('https://login.tidal.com/authorize')
    expect(url.searchParams.get('client_id')).toBe('app-id')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT_URI)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toBeTruthy()
    expect(url.searchParams.get('state')).toBeTruthy()
    expect((url.searchParams.get('scope') ?? '').split(' ')).toContain('collection.read')
  })

  it('ignores a client-supplied redirect URI when ALLOWED_ORIGIN is configured', async () => {
    vi.resetModules()
    vi.stubEnv('ALLOWED_ORIGIN', 'https://digarr.example')
    const { oauthRoutes: scopedRoutes } = await import('@/server/routes/oauth')
    const app = new Hono<HonoEnv>()
    app.use('*', async (c, next) => {
      c.set('userId', 1)
      return next()
    })
    app.route('/', scopedRoutes(makeDeps(configuredSettings) as never))

    const res = await app.request('/api/v1/auth/oauth/tidal/initiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirectUri: 'https://attacker.example/steal' }),
    })
    const url = new URL((await res.json()).authUrl)
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://digarr.example/api/v1/auth/oauth/tidal/callback',
    )
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('stashes the verifier and redirect URI on the pending row, and the challenge matches it', async () => {
    const res = await initiate(makeDeps(configuredSettings))
    const url = new URL((await res.json()).authUrl)

    expect(upsertOAuthToken).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        provider: 'tidal',
        accessToken: expect.stringContaining('pending:'),
        clientId: 'app-id',
      }),
    )
    const stashed = JSON.parse(vi.mocked(upsertOAuthToken).mock.calls[0]?.[1].refreshToken ?? '{}')
    expect(stashed.redirectUri).toBe(REDIRECT_URI)
    expect(createHash('sha256').update(stashed.codeVerifier).digest('base64url')).toBe(
      url.searchParams.get('code_challenge'),
    )
  })
})

describe('GET /api/v1/auth/oauth/tidal/callback', () => {
  const pendingRow = {
    userId: 1,
    accessToken: 'pending:1:state-123',
    refreshToken: JSON.stringify({ redirectUri: REDIRECT_URI, codeVerifier: 'verifier-123' }),
    clientId: 'app-id',
    clientSecret: 'app-secret',
  }

  it('redirects with no_pending_auth when no pending row matches the state', async () => {
    vi.mocked(findPendingOAuthByState).mockResolvedValue(null)
    const res = await createApp(makeDeps(configuredSettings)).request(
      '/api/v1/auth/oauth/tidal/callback?code=abc&state=state-123',
    )
    expect(res.headers.get('location')).toContain('oauth_error=no_pending_auth')
  })

  it('exchanges the code with the stored verifier and persists the token', async () => {
    vi.mocked(findPendingOAuthByState).mockResolvedValue(pendingRow as never)
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: 'access-1',
          refresh_token: 'refresh-1',
          expires_in: 3600,
          scope: 'user.read collection.read',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const res = await createApp(makeDeps(configuredSettings)).request(
      '/api/v1/auth/oauth/tidal/callback?code=abc&state=state-123',
    )

    const [tokenUrl, init] = fetchMock.mock.calls[0] ?? []
    expect(tokenUrl).toBe('https://auth.tidal.com/v1/oauth2/token')
    const sent = new URLSearchParams(String((init as RequestInit).body))
    expect(sent.get('grant_type')).toBe('authorization_code')
    expect(sent.get('code_verifier')).toBe('verifier-123')
    expect(sent.get('redirect_uri')).toBe(REDIRECT_URI)

    expect(upsertOAuthToken).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        provider: 'tidal',
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
      }),
    )
    expect(res.headers.get('location')).toContain('oauth_success=tidal')
  })

  it('redirects with token_exchange_failed when TIDAL rejects the code', async () => {
    vi.mocked(findPendingOAuthByState).mockResolvedValue(pendingRow as never)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 400 }))

    const res = await createApp(makeDeps(configuredSettings)).request(
      '/api/v1/auth/oauth/tidal/callback?code=abc&state=state-123',
    )
    expect(res.headers.get('location')).toContain('oauth_error=token_exchange_failed')
  })
})
