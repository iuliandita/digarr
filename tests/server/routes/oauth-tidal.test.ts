// @vitest-environment node

import { createHash } from 'node:crypto'
import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '@/server/types'

vi.mock('@/db/queries/oauth-tokens', () => ({
  getOAuthToken: vi.fn(),
  upsertOAuthToken: vi.fn(),
  deleteOAuthToken: vi.fn(),
}))

vi.mock('@/db/queries/oauth-pending', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db/queries/oauth-pending')>()),
  createPendingOAuth: vi.fn(),
  consumePendingOAuth: vi.fn(),
}))

const { upsertOAuthToken } = await import('@/db/queries/oauth-tokens')
const { createPendingOAuth, consumePendingOAuth, hashOAuthValue } = await import(
  '@/db/queries/oauth-pending'
)
const { oauthTransactionCookieName } = await import('@/server/helpers/oauth-transaction-cookie')
const { oauthRoutes } = await import('@/server/routes/oauth')

const REDIRECT_URI = 'http://localhost:3000/api/v1/auth/oauth/tidal/callback'
const STATE = 'state-123'
const BINDING = 'binding-123'

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

function callback(deps: ReturnType<typeof makeDeps>, binding: string | null = BINDING) {
  const headers: Record<string, string> = {}
  if (binding !== null) {
    headers.Cookie = `${oauthTransactionCookieName('tidal', STATE)}=${binding}`
  }
  return createApp(deps).request(`/api/v1/auth/oauth/tidal/callback?code=abc&state=${STATE}`, {
    headers,
  })
}

const configuredSettings = { tidalClientId: 'app-id', tidalClientSecret: 'app-secret' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(upsertOAuthToken).mockResolvedValue({} as never)
  vi.mocked(createPendingOAuth).mockResolvedValue(undefined)
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

  it('sets an HttpOnly transaction cookie scoped to the callback path', async () => {
    const res = await initiate(makeDeps(configuredSettings))
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('digarr_oauth_')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('Path=/api/v1/auth/oauth/tidal/callback')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('rejects a non-loopback redirect URI when ALLOWED_ORIGIN is unset', async () => {
    const res = await initiate(makeDeps(configuredSettings), {
      redirectUri: 'https://attacker.example/steal',
    })
    expect(res.status).toBe(400)
    expect(createPendingOAuth).not.toHaveBeenCalled()
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

    expect(createPendingOAuth).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ provider: 'tidal', clientId: 'app-id' }),
    )
    const params = vi.mocked(createPendingOAuth).mock.calls[0]?.[1]
    expect(params?.payload?.redirectUri).toBe(REDIRECT_URI)
    expect(
      createHash('sha256')
        .update(params?.payload?.codeVerifier ?? '')
        .digest('base64url'),
    ).toBe(url.searchParams.get('code_challenge'))
    // The raw state and binding are handed to the query layer, which stores only digests.
    expect(params?.state).toBe(url.searchParams.get('state'))
    expect(params?.binding).toBeTruthy()
  })
})

describe('GET /api/v1/auth/oauth/tidal/callback', () => {
  const pending = {
    userId: 1,
    provider: 'tidal',
    bindingHash: hashOAuthValue(BINDING),
    payload: { redirectUri: REDIRECT_URI, codeVerifier: 'verifier-123' },
    scopes: null,
    clientId: 'app-id',
    clientSecret: 'app-secret',
    expiresAt: new Date(Date.now() + 60_000),
  }

  it('redirects with no_pending_auth when no pending row matches the state', async () => {
    vi.mocked(consumePendingOAuth).mockResolvedValue(null)
    const res = await callback(makeDeps(configuredSettings))
    expect(res.headers.get('location')).toContain('oauth_error=no_pending_auth')
  })

  it('redirects with state_expired once the pending TTL has passed', async () => {
    vi.mocked(consumePendingOAuth).mockResolvedValue({
      ...pending,
      expiresAt: new Date(Date.now() - 1000),
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const res = await callback(makeDeps(configuredSettings))
    expect(res.headers.get('location')).toContain('oauth_error=state_expired')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('redirects with browser_mismatch when the transaction cookie is missing', async () => {
    vi.mocked(consumePendingOAuth).mockResolvedValue(pending)
    const res = await callback(makeDeps(configuredSettings), null)
    expect(res.headers.get('location')).toContain('oauth_error=browser_mismatch')
  })

  it('redirects with browser_mismatch when the transaction cookie does not match', async () => {
    vi.mocked(consumePendingOAuth).mockResolvedValue(pending)
    const res = await callback(makeDeps(configuredSettings), 'not-the-binding')
    expect(res.headers.get('location')).toContain('oauth_error=browser_mismatch')
  })

  it('exchanges the code with the stored verifier and persists the token', async () => {
    vi.mocked(consumePendingOAuth).mockResolvedValue(pending)
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

    const res = await callback(makeDeps(configuredSettings))

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
    vi.mocked(consumePendingOAuth).mockResolvedValue(pending)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 400 }))

    const res = await callback(makeDeps(configuredSettings))
    expect(res.headers.get('location')).toContain('oauth_error=token_exchange_failed')
  })

  it('redirects with token_exchange_unreachable when the token request throws', async () => {
    vi.mocked(consumePendingOAuth).mockResolvedValue(pending)
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('connect ETIMEDOUT'))

    const res = await callback(makeDeps(configuredSettings))
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('oauth_error=token_exchange_unreachable')
  })

  it('redirects with token_exchange_no_token when the response omits the access token', async () => {
    vi.mocked(consumePendingOAuth).mockResolvedValue(pending)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ token_type: 'Bearer' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const res = await callback(makeDeps(configuredSettings))
    expect(res.headers.get('location')).toContain('oauth_error=token_exchange_no_token')
  })
})
