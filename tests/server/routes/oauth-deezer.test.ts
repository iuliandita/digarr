// @vitest-environment node

import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '@/server/types'

vi.mock('@/config/env', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/config/env')>()
  return {
    ...original,
    envConfig: {
      ...original.envConfig,
      deezerAppId: 'test-app-id',
      deezerAppSecret: 'test-app-secret',
    },
  }
})

vi.mock('@/db/queries/oauth-tokens', () => ({
  getOAuthToken: vi.fn(),
  upsertOAuthToken: vi.fn(),
  deleteOAuthToken: vi.fn(),
  findPendingOAuthByState: vi.fn(),
}))

const { upsertOAuthToken, findPendingOAuthByState } = await import('@/db/queries/oauth-tokens')
const { oauthRoutes } = await import('@/server/routes/oauth')

function makeDeps() {
  return {
    db: {} as never,
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

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(upsertOAuthToken).mockResolvedValue({} as never)
})

// ---------------------------------------------------------------------------
// POST /api/auth/oauth/deezer/initiate
// ---------------------------------------------------------------------------

describe('POST /api/auth/oauth/deezer/initiate', () => {
  it('returns 401 when not authenticated', async () => {
    const app = createApp(makeDeps(), false)
    const res = await app.request('/api/auth/oauth/deezer/initiate', { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('returns 400 when deezer env vars are not set', async () => {
    // Override envConfig to have no deezer creds
    const { envConfig } = await import('@/config/env')
    const original = { ...envConfig }
    ;(envConfig as Record<string, unknown>).deezerAppId = undefined
    ;(envConfig as Record<string, unknown>).deezerAppSecret = undefined

    const app = createApp(makeDeps())
    const res = await app.request('/api/auth/oauth/deezer/initiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/credentials/i)

    // Restore
    ;(envConfig as Record<string, unknown>).deezerAppId = original.deezerAppId
    ;(envConfig as Record<string, unknown>).deezerAppSecret = original.deezerAppSecret
  })

  it('returns authUrl pointing to deezer with correct params', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/auth/oauth/deezer/initiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', host: 'example.com' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.authUrl).toContain('https://connect.deezer.com/oauth/auth.php')
    const url = new URL(body.authUrl)
    expect(url.searchParams.get('app_id')).toBe('test-app-id')
    expect(url.searchParams.get('perms')).toContain('basic_access')
    expect(url.searchParams.get('redirect_uri')).toContain('/api/auth/oauth/deezer/callback')
    expect(url.searchParams.get('state')).toBeTruthy()
  })

  it('uses x-forwarded-proto header for redirect_uri', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/auth/oauth/deezer/initiate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        host: 'myhost.example.com',
        'x-forwarded-proto': 'https',
      },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    const url = new URL(body.authUrl)
    const redirectUri = url.searchParams.get('redirect_uri') ?? ''
    expect(redirectUri).toMatch(/^https:\/\/myhost\.example\.com\//)
  })

  it('stores a pending token with null clientId and clientSecret', async () => {
    const app = createApp(makeDeps())
    await app.request('/api/auth/oauth/deezer/initiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(upsertOAuthToken).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        provider: 'deezer',
        accessToken: expect.stringContaining('pending:'),
        clientId: null,
        clientSecret: null,
        refreshToken: null,
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// GET /api/auth/oauth/deezer/callback
// ---------------------------------------------------------------------------

function makePendingToken(state: string, userId = 1) {
  return {
    userId,
    provider: 'deezer',
    accessToken: `pending:${userId}:${state}`,
    refreshToken: null,
    clientId: null,
    clientSecret: null,
    scopes: 'basic_access,email,listening_history,manage_library',
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  }
}

describe('GET /api/auth/oauth/deezer/callback', () => {
  it('redirects with oauth_error when error query param is present', async () => {
    const app = createApp(makeDeps())
    const res = await app.request(
      '/api/auth/oauth/deezer/callback?error=access_denied&state=s&code=c',
    )
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toContain('oauth_error=access_denied')
  })

  it('redirects with oauth_error when error_reason is present (Deezer denial)', async () => {
    const app = createApp(makeDeps())
    const res = await app.request(
      '/api/auth/oauth/deezer/callback?error_reason=user_denied&state=s',
    )
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toContain('oauth_error=user_denied')
  })

  it('redirects with oauth_error when code or state is missing', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/auth/oauth/deezer/callback?code=abc')
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toContain('oauth_error=missing_code_or_state')
  })

  it('redirects with no_pending_auth when no pending token found', async () => {
    vi.mocked(findPendingOAuthByState).mockResolvedValue(null)
    const app = createApp(makeDeps())
    const res = await app.request('/api/auth/oauth/deezer/callback?code=abc&state=no-such-state')
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toContain('oauth_error=no_pending_auth')
  })

  it('redirects with state_mismatch when state does not match pending token', async () => {
    vi.mocked(findPendingOAuthByState).mockResolvedValue(makePendingToken('real-state') as never)
    const app = createApp(makeDeps())
    const res = await app.request(
      '/api/auth/oauth/deezer/callback?code=auth-code&state=wrong-state',
    )
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toContain('oauth_error=state_mismatch')
  })

  it('redirects with oauth_success=deezer on successful JSON token exchange', async () => {
    const state = 'test-state-uuid'
    vi.mocked(findPendingOAuthByState).mockResolvedValue(makePendingToken(state) as never)

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ access_token: 'deezer-at-123', expires: 7776000 }),
    } as Response)

    const app = createApp(makeDeps())
    const res = await app.request(`/api/auth/oauth/deezer/callback?code=auth-code&state=${state}`)
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('/settings?oauth_success=deezer')
  })

  it('stores token with null refreshToken, clientId, clientSecret', async () => {
    const state = 'test-state-uuid-2'
    vi.mocked(findPendingOAuthByState).mockResolvedValue(makePendingToken(state) as never)

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ access_token: 'deezer-at-456', expires: 7776000 }),
    } as Response)

    const app = createApp(makeDeps())
    await app.request(`/api/auth/oauth/deezer/callback?code=auth-code&state=${state}`)

    expect(upsertOAuthToken).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        provider: 'deezer',
        accessToken: 'deezer-at-456',
        refreshToken: null,
        clientId: null,
        clientSecret: null,
      }),
    )
  })

  it('treats expires=0 as 1 year expiry', async () => {
    const state = 'test-state-uuid-3'
    vi.mocked(findPendingOAuthByState).mockResolvedValue(makePendingToken(state) as never)

    const before = Date.now()
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ access_token: 'deezer-at-long', expires: 0 }),
    } as Response)

    const app = createApp(makeDeps())
    await app.request(`/api/auth/oauth/deezer/callback?code=auth-code&state=${state}`)

    const call = vi.mocked(upsertOAuthToken).mock.calls[0]?.[1]
    const expiresAt = call?.expiresAt as Date
    const oneYear = 365 * 24 * 3600 * 1000
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + oneYear - 1000)
    expect(expiresAt.getTime()).toBeLessThanOrEqual(before + oneYear + 5000)
  })

  it('falls back to form-encoded parsing when JSON parse fails', async () => {
    const state = 'test-state-uuid-4'
    vi.mocked(findPendingOAuthByState).mockResolvedValue(makePendingToken(state) as never)

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => 'access_token=form-encoded-token&expires=86400',
    } as Response)

    const app = createApp(makeDeps())
    const res = await app.request(`/api/auth/oauth/deezer/callback?code=auth-code&state=${state}`)
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('/settings?oauth_success=deezer')
    expect(upsertOAuthToken).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ accessToken: 'form-encoded-token' }),
    )
  })

  it('redirects with token_exchange_failed when fetch returns non-ok status', async () => {
    const state = 'test-state-uuid-5'
    vi.mocked(findPendingOAuthByState).mockResolvedValue(makePendingToken(state) as never)

    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 } as Response)

    const app = createApp(makeDeps())
    const res = await app.request(`/api/auth/oauth/deezer/callback?code=auth-code&state=${state}`)
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toContain('oauth_error=token_exchange_failed')
  })

  it('redirects with token_exchange_failed when response has no access_token', async () => {
    const state = 'test-state-uuid-6'
    vi.mocked(findPendingOAuthByState).mockResolvedValue(makePendingToken(state) as never)

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ error: 'OAuthException' }),
    } as Response)

    const app = createApp(makeDeps())
    const res = await app.request(`/api/auth/oauth/deezer/callback?code=auth-code&state=${state}`)
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toContain('oauth_error=token_exchange_failed')
  })

  it('calls Deezer token endpoint with app_id, secret, code, output=json', async () => {
    const state = 'test-state-uuid-7'
    vi.mocked(findPendingOAuthByState).mockResolvedValue(makePendingToken(state) as never)

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ access_token: 'deezer-at', expires: 3600 }),
    } as Response)

    const app = createApp(makeDeps())
    await app.request(`/api/auth/oauth/deezer/callback?code=my-code&state=${state}`)

    const fetchCall = vi.mocked(global.fetch).mock.calls[0]
    const calledUrl = fetchCall?.[0] as string
    const url = new URL(calledUrl)
    expect(url.origin + url.pathname).toBe('https://connect.deezer.com/oauth/access_token.php')
    expect(url.searchParams.get('app_id')).toBe('test-app-id')
    expect(url.searchParams.get('secret')).toBe('test-app-secret')
    expect(url.searchParams.get('code')).toBe('my-code')
    expect(url.searchParams.get('output')).toBe('json')
  })
})
