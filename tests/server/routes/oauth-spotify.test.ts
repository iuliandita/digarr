// @vitest-environment node

import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '@/server/types'

vi.mock('@/db/queries/oauth-tokens', () => ({
  getOAuthToken: vi.fn(),
  upsertOAuthToken: vi.fn(),
  deleteOAuthToken: vi.fn(),
  findPendingOAuthByState: vi.fn(),
}))

const { upsertOAuthToken } = await import('@/db/queries/oauth-tokens')
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

const initiateBody = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  redirectUri: 'https://example.com/api/v1/auth/oauth/spotify/callback',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(upsertOAuthToken).mockResolvedValue({} as never)
})

// ---------------------------------------------------------------------------
// POST /api/v1/auth/oauth/spotify/initiate
// ---------------------------------------------------------------------------

describe('POST /api/v1/auth/oauth/spotify/initiate', () => {
  it('returns 401 when not authenticated', async () => {
    const app = createApp(makeDeps(), false)
    const res = await app.request('/api/v1/auth/oauth/spotify/initiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(initiateBody),
    })
    expect(res.status).toBe(401)
  })

  it('returns 400 when client credentials are missing', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/v1/auth/oauth/spotify/initiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: 'cid' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns authUrl pointing to Spotify with correct params', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/v1/auth/oauth/spotify/initiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(initiateBody),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.authUrl).toContain('https://accounts.spotify.com/authorize')
    const url = new URL(body.authUrl)
    expect(url.searchParams.get('client_id')).toBe('test-client-id')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('redirect_uri')).toBe(initiateBody.redirectUri)
    expect(url.searchParams.get('state')).toBeTruthy()
  })

  // Regression guard for the Liked Songs 403: GET /me/tracks needs
  // user-library-read, so the OAuth grant must request that scope.
  it('requests the user-library-read scope (Liked Songs import)', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/v1/auth/oauth/spotify/initiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(initiateBody),
    })
    const body = await res.json()
    const scope = new URL(body.authUrl).searchParams.get('scope') ?? ''
    expect(scope.split(' ')).toContain('user-library-read')
  })

  it('persists the requested scopes on the pending token', async () => {
    const app = createApp(makeDeps())
    await app.request('/api/v1/auth/oauth/spotify/initiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(initiateBody),
    })
    expect(upsertOAuthToken).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        provider: 'spotify',
        accessToken: expect.stringContaining('pending:'),
        scopes: expect.stringContaining('user-library-read'),
      }),
    )
  })
})
