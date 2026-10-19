// @vitest-environment node
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initEncryption } from '@/core/crypto'
import { authGuard } from '@/server/middleware/auth'
import type { HonoEnv } from '@/server/types'

vi.mock('@/config/env', () => ({
  envConfig: { allowedOrigin: 'https://digarr.example', lastfmSharedSecret: 'shared-secret' },
}))
vi.mock('@/db/queries/users', () => ({ getUserConnections: vi.fn() }))
vi.mock('@/db/queries/oauth-pending', async (original) => ({
  ...(await original<typeof import('@/db/queries/oauth-pending')>()),
  createPendingOAuth: vi.fn(),
  consumePendingOAuth: vi.fn(),
}))
vi.mock('@/db/queries/oauth-tokens', async (original) => ({
  ...(await original<typeof import('@/db/queries/oauth-tokens')>()),
  getOAuthToken: vi.fn(),
  deleteOAuthToken: vi.fn(),
}))

const { getUserConnections } = await import('@/db/queries/users')
const { createPendingOAuth, consumePendingOAuth, hashOAuthValue } = await import(
  '@/db/queries/oauth-pending'
)
const { getOAuthToken } = await import('@/db/queries/oauth-tokens')
const { oauthRoutes } = await import('@/server/routes/oauth')
const { oauthTransactionCookieName } = await import('@/server/helpers/oauth-transaction-cookie')
const STATE = 'state'
const BINDING = 'browser'

function pending() {
  return {
    userId: 7,
    provider: 'lastfm',
    bindingHash: hashOAuthValue(BINDING),
    payload: { requestToken: 'request-token' },
    clientId: 'api-key',
    clientSecret: 'shared-secret',
    scopes: null,
    expiresAt: new Date(Date.now() + 60000),
  }
}

function app(authed = true) {
  let stored: Record<string, unknown> | undefined
  const chain = {
    values: vi.fn((data: Record<string, unknown>) => {
      stored = data
      return chain
    }),
    onConflictDoUpdate: vi.fn(() => chain),
    returning: vi.fn(async () => [stored]),
  }
  const db = { insert: vi.fn(() => chain) }
  const app = new Hono<HonoEnv>()
  app.use('*', async (c, next) => {
    if (authed) c.set('userId', 7)
    return next()
  })
  app.route('/', oauthRoutes({ db, targetQueries: {} } as never))
  return { app, db, stored: () => stored }
}

function callback(app: Hono<HonoEnv>, token = 'request-token', binding: string | null = BINDING) {
  return app.request(`/api/v1/auth/oauth/lastfm/callback/${STATE}?token=${token}`, {
    headers: binding ? { Cookie: `${oauthTransactionCookieName('lastfm', STATE)}=${binding}` } : {},
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  initEncryption('lastfm-test-encryption-key')
  vi.mocked(getUserConnections).mockResolvedValue({ lastfmApiKey: 'api-key' } as never)
  vi.mocked(consumePendingOAuth).mockResolvedValue(pending())
})
afterEach(() => {
  vi.restoreAllMocks()
  initEncryption(undefined)
})

describe('Last.fm authorization', () => {
  it('starts only on an authenticated request with encrypted persistence available', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"token":"request-token"}'))
    const initiate = (authed = true) =>
      app(authed).app.request('/api/v1/auth/oauth/lastfm/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
    expect((await initiate(false)).status).toBe(401)
    initEncryption(undefined)
    expect((await initiate()).status).toBe(400)
    expect(fetch).not.toHaveBeenCalled()
    initEncryption('lastfm-test-encryption-key')
    const response = await initiate()
    expect(response.status).toBe(200)
    const url = new URL((await response.json()).authUrl)
    const stored = vi.mocked(createPendingOAuth).mock.calls[0]?.[1]
    expect(stored).toEqual(
      expect.objectContaining({
        userId: 7,
        provider: 'lastfm',
        clientId: 'api-key',
        clientSecret: 'shared-secret',
        payload: { requestToken: 'request-token' },
      }),
    )
    const callbackUrl = new URL(url.searchParams.get('cb') ?? '')
    expect(callbackUrl.href).toBe(
      `https://digarr.example/api/v1/auth/oauth/lastfm/callback/${stored?.state}`,
    )
    expect(callbackUrl.search).toBe('')
    expect(url.searchParams.get('token')).toBe('request-token')
    expect(response.headers.get('set-cookie')).toContain('HttpOnly')
    expect(response.headers.get('set-cookie')).toContain('Path=/api/v1/auth/oauth/lastfm/callback')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('allows the state-bearing callback through auth without a session', async () => {
    const context = app(false)
    const guarded = new Hono<HonoEnv>()
    guarded.use('*', authGuard({ hasUsers: async () => true, isSetupComplete: async () => true }))
    guarded.route('/', context.app)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"session":{"key":"session-key"}}'),
    )
    const response = await callback(guarded)
    expect(response.headers.get('location')).toBe('/settings?oauth_success=lastfm')
    expect(consumePendingOAuth).toHaveBeenCalledWith(expect.anything(), 'lastfm', STATE)
    expect(response.headers.get('set-cookie')).toContain('Path=/api/v1/auth/oauth/lastfm/callback')
  })

  it.each(['missing', 'expired', 'missing-browser', 'wrong-browser', 'forged-token'] as const)(
    'rejects %s without exchanging any token',
    async (failure) => {
      const fetch = vi.spyOn(globalThis, 'fetch')
      if (failure === 'missing') vi.mocked(consumePendingOAuth).mockResolvedValue(null)
      if (failure === 'expired')
        vi.mocked(consumePendingOAuth).mockResolvedValue({ ...pending(), expiresAt: new Date(0) })
      const response = await callback(
        app().app,
        failure === 'forged-token' ? 'forged' : 'request-token',
        failure === 'missing-browser' ? null : failure === 'wrong-browser' ? 'wrong' : BINDING,
      )
      const error =
        failure === 'missing'
          ? 'no_pending_auth'
          : failure === 'expired'
            ? 'state_expired'
            : failure === 'forged-token'
              ? 'token_mismatch'
              : 'browser_mismatch'
      expect(response.headers.get('location')).toBe(`/settings?oauth_error=${error}`)
      expect(fetch).not.toHaveBeenCalled()
    },
  )

  it('stores an encrypted non-expiring session and rejects replay without changing preferences', async () => {
    vi.mocked(consumePendingOAuth).mockResolvedValueOnce(pending()).mockResolvedValueOnce(null)
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"session":{"key":"session-key"}}'))
    const context = app(false)
    const response = await callback(context.app)
    expect(response.headers.get('location')).toBe('/settings?oauth_success=lastfm')
    expect(context.stored()).toEqual(
      expect.objectContaining({
        provider: 'lastfm',
        userId: 7,
        accessToken: expect.stringMatching(/^enc:v1:/),
        clientSecret: expect.stringMatching(/^enc:v1:/),
        clientId: 'api-key',
        expiresAt: new Date('9999-12-31T23:59:59.999Z'),
      }),
    )
    expect(JSON.stringify(context.stored())).not.toContain('session-key')
    expect((await callback(context.app)).headers.get('location')).toContain(
      'oauth_error=no_pending_auth',
    )
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('reports only safe status metadata and requires credentials to match the current configuration', async () => {
    vi.mocked(getOAuthToken).mockResolvedValue({
      accessToken: 'session-key',
      clientId: 'api-key',
      clientSecret: 'shared-secret',
    } as never)
    const response = await app().app.request('/api/v1/auth/oauth/lastfm/status')
    expect(await response.json()).toEqual({
      configured: true,
      connected: true,
      scopes: null,
      expiresAt: null,
    })
    vi.mocked(getUserConnections).mockResolvedValue({ lastfmApiKey: 'changed-key' } as never)
    const changed = await app().app.request('/api/v1/auth/oauth/lastfm/status')
    expect((await changed.json()).connected).toBe(false)
  })
})
