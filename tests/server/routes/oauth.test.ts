// @vitest-environment node
import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '@/server/types'

vi.mock('@/db/queries/oauth-tokens', () => ({
  getOAuthToken: vi.fn(),
  upsertOAuthToken: vi.fn(),
  deleteOAuthToken: vi.fn(),
}))

const { getOAuthToken, deleteOAuthToken } = await import('@/db/queries/oauth-tokens')
const { oauthRoutes } = await import('@/server/routes/oauth')

const db = {} as never

function createApp(userId: number | null = 1) {
  const app = new Hono<HonoEnv>()
  app.use('*', async (c, next) => {
    if (userId !== null) c.set('userId', userId)
    return next()
  })
  app.route('/', oauthRoutes({ db, targetQueries: {} } as never))
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(deleteOAuthToken).mockResolvedValue(undefined)
})

describe('DELETE /api/v1/auth/oauth/:provider', () => {
  it('disconnects the provider for the calling user only', async () => {
    const res = await createApp(7).request('/api/v1/auth/oauth/spotify', { method: 'DELETE' })

    expect(res.status).toBe(204)
    expect(deleteOAuthToken).toHaveBeenCalledOnce()
    expect(deleteOAuthToken).toHaveBeenCalledWith(db, 7, 'spotify')
  })

  it('returns 401 and deletes nothing when unauthenticated', async () => {
    const res = await createApp(null).request('/api/v1/auth/oauth/spotify', { method: 'DELETE' })

    expect(res.status).toBe(401)
    expect(deleteOAuthToken).not.toHaveBeenCalled()
  })
})

describe('GET /api/v1/auth/oauth/:provider/status', () => {
  it('reports a connected provider with its scopes and expiry', async () => {
    const expiresAt = new Date('2030-01-01T00:00:00.000Z')
    vi.mocked(getOAuthToken).mockResolvedValue({ scopes: 'user-top-read', expiresAt } as never)

    const res = await createApp(3).request('/api/v1/auth/oauth/spotify/status')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      connected: true,
      scopes: 'user-top-read',
      expiresAt: expiresAt.toISOString(),
    })
    expect(getOAuthToken).toHaveBeenCalledWith(db, 3, 'spotify')
  })

  it('reports not connected when no token is stored', async () => {
    vi.mocked(getOAuthToken).mockResolvedValue(null)

    const res = await createApp().request('/api/v1/auth/oauth/tidal/status')

    expect(await res.json()).toEqual({ connected: false, scopes: null, expiresAt: null })
  })

  it('returns 401 when unauthenticated', async () => {
    const res = await createApp(null).request('/api/v1/auth/oauth/spotify/status')

    expect(res.status).toBe(401)
    expect(getOAuthToken).not.toHaveBeenCalled()
  })
})
