import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSession, getSession } from '@/core/sessions'
import { proxyAuthMiddleware } from '@/server/middleware/proxy-auth'
import { SESSION_COOKIE_NAME } from '@/server/middleware/session-cookie'

vi.mock('@/core/sessions', () => ({
  createSession: vi.fn(async () => {}),
  getSession: vi.fn(async () => null),
}))
vi.mock('@/core/auth', () => ({
  generateSessionToken: vi.fn(() => 'test-token-123'),
  hashPassword: vi.fn(() => 'dummy-hash'),
}))

describe('proxyAuthMiddleware', () => {
  const mockGetUserByUsername = vi.fn()
  const mockCreateUser = vi.fn(async (data: { username: string }) => ({
    id: 1,
    username: data.username,
    isAdmin: false,
    createdAt: new Date(),
  }))
  const mockGetUserCount = vi.fn(async () => 0)

  function buildApp(trustedProxies: string[]) {
    const app = new Hono()
    app.use(
      '*',
      proxyAuthMiddleware({
        enabled: true,
        trustedProxies,
        getUserByUsername: mockGetUserByUsername,
        createUser: mockCreateUser,
        getUserCount: mockGetUserCount,
      }),
    )
    app.get('/test', (c) => {
      const userId = c.get('userId' as never)
      const proxyAuth = c.get('proxyAuth' as never)
      return c.json({ userId, proxyAuth })
    })
    return app
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUserByUsername.mockResolvedValue(null)
    mockGetUserCount.mockResolvedValue(0)
    vi.mocked(getSession).mockResolvedValue(null)
  })

  // Note: In tests, getSocketIp() falls back to '0.0.0.0' (no real socket, fail-closed).
  // Trust '0.0.0.0/32' to test the happy path. For untrusted scenarios,
  // use a CIDR that excludes 0.0.0.0 (e.g., '10.0.0.0/8').

  it('auto-provisions user when X-Forwarded-User is present from trusted proxy', async () => {
    const app = buildApp(['0.0.0.0/32'])
    const res = await app.request('/test', {
      headers: { 'X-Forwarded-User': 'alice' },
    })
    expect(res.status).toBe(200)
    expect(mockCreateUser).toHaveBeenCalled()
  })

  it('reuses existing user when found', async () => {
    mockGetUserByUsername.mockResolvedValue({
      id: 42,
      username: 'bob',
      passwordHash: 'h',
      isAdmin: true,
      createdAt: new Date(),
    })
    const app = buildApp(['0.0.0.0/32'])
    const res = await app.request('/test', {
      headers: { 'X-Forwarded-User': 'bob' },
    })
    expect(res.status).toBe(200)
    expect(mockCreateUser).not.toHaveBeenCalled()
  })

  it('silently falls through when proxy IP is not trusted', async () => {
    const app = buildApp(['10.0.0.0/8'])
    const res = await app.request('/test', {
      headers: { 'X-Forwarded-User': 'mallory' },
    })
    const body = await res.json()
    expect(body.proxyAuth).toBeUndefined()
  })

  it('silently falls through when no X-Forwarded-User header', async () => {
    const app = buildApp(['0.0.0.0/32'])
    const res = await app.request('/test')
    const body = await res.json()
    expect(body.proxyAuth).toBeUndefined()
  })

  it('first proxy user becomes admin', async () => {
    mockGetUserCount.mockResolvedValue(0)
    const app = buildApp(['0.0.0.0/32'])
    await app.request('/test', {
      headers: { 'X-Forwarded-User': 'firstuser' },
    })
    expect(mockCreateUser).toHaveBeenCalledWith(expect.objectContaining({ isAdmin: true }))
  })

  it('skips all processing when disabled', async () => {
    const app = new Hono()
    app.use(
      '*',
      proxyAuthMiddleware({
        enabled: false,
        trustedProxies: ['0.0.0.0/32'],
        getUserByUsername: mockGetUserByUsername,
        createUser: mockCreateUser,
        getUserCount: mockGetUserCount,
      }),
    )
    app.get('/test', (c) => c.json({ proxyAuth: c.get('proxyAuth' as never) }))
    const res = await app.request('/test', { headers: { 'X-Forwarded-User': 'alice' } })
    const body = await res.json()
    expect(body.proxyAuth).toBeUndefined()
  })

  it('sets a session cookie when minting a new session', async () => {
    mockGetUserByUsername.mockResolvedValue({
      id: 10,
      username: 'carol',
      passwordHash: 'h',
      isAdmin: false,
    })
    const app = buildApp(['0.0.0.0/32'])
    const res = await app.request('/test', { headers: { 'X-Forwarded-User': 'carol' } })
    expect(createSession).toHaveBeenCalledWith(10, 'test-token-123')
    const cookie = res.headers.get('set-cookie')
    expect(cookie).toBeTruthy()
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=test-token-123`)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toMatch(/SameSite=Lax/i)
  })

  it('does not re-mint when the inbound cookie matches the same user', async () => {
    vi.mocked(getSession).mockResolvedValue({ userId: 10 })
    mockGetUserByUsername.mockResolvedValue({
      id: 10,
      username: 'carol',
      passwordHash: 'h',
      isAdmin: false,
    })
    const app = buildApp(['0.0.0.0/32'])
    const res = await app.request('/test', {
      headers: {
        'X-Forwarded-User': 'carol',
        cookie: `${SESSION_COOKIE_NAME}=existing-valid-token`,
      },
    })
    expect(res.status).toBe(200)
    expect(createSession).not.toHaveBeenCalled()
  })

  it('mints a fresh session when the inbound cookie belongs to a different user', async () => {
    // Password-mode user 99 is cached in the cookie; proxy now says user 10.
    // Must NOT reuse user 99's token - that was the cross-mode leak.
    vi.mocked(getSession).mockResolvedValue({ userId: 99 })
    mockGetUserByUsername.mockResolvedValue({
      id: 10,
      username: 'carol',
      passwordHash: 'h',
      isAdmin: false,
    })
    const app = buildApp(['0.0.0.0/32'])
    const res = await app.request('/test', {
      headers: {
        'X-Forwarded-User': 'carol',
        cookie: `${SESSION_COOKIE_NAME}=user-99-token`,
      },
    })
    expect(createSession).toHaveBeenCalledWith(10, 'test-token-123')
    const cookie = res.headers.get('set-cookie')
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=test-token-123`)
  })

  it('silently falls through when X-Forwarded-User is empty after trim', async () => {
    const app = buildApp(['0.0.0.0/32'])
    const res = await app.request('/test', { headers: { 'X-Forwarded-User': '   ' } })
    const body = await res.json()
    expect(body.proxyAuth).toBeUndefined()
  })

  it('silently falls through when X-Forwarded-User exceeds 50 chars', async () => {
    const app = buildApp(['0.0.0.0/32'])
    const res = await app.request('/test', { headers: { 'X-Forwarded-User': 'a'.repeat(51) } })
    const body = await res.json()
    expect(body.proxyAuth).toBeUndefined()
  })
})
