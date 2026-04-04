// @vitest-environment node

import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OidcService } from '@/core/auth/oidc'
import { clearAllSessions } from '@/core/sessions'
import { oidcRoutes } from '@/server/routes/oidc'

vi.mock('@/config/env', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/config/env')>()
  return {
    ...original,
    envConfig: { ...original.envConfig, allowedOrigin: 'http://localhost:3000' },
  }
})

vi.mock('@/core/auth', () => ({
  generateSessionToken: vi.fn(() => 'mock-session-token-123'),
  hashPassword: vi.fn(() => 'mocked-hash'),
}))

vi.mock('@/core/sessions', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/core/sessions')>()
  return {
    ...orig,
    createSession: vi.fn(async () => {}),
  }
})

import { createSession } from '@/core/sessions'

function makeMockOidcService() {
  return {
    getAuthorizationUrl: vi.fn(async () => ({
      url: 'https://idp.example.com/authorize?state=abc&code_challenge=xyz',
      state: 'abc',
    })),
    handleCallback: vi.fn(async () => ({
      claims: {
        sub: 'oidc-subject-123',
        email: 'alice@example.com',
        preferredUsername: 'alice',
        name: 'Alice Doe',
      },
      accessToken: 'at-xyz',
      refreshToken: 'rt-xyz',
      idToken: 'id-xyz',
      expiresIn: 3600,
    })),
    resetDiscovery: vi.fn(),
  }
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  const mockOidcService = makeMockOidcService() as unknown as OidcService & {
    getAuthorizationUrl: ReturnType<typeof vi.fn>
    handleCallback: ReturnType<typeof vi.fn>
  }
  return {
    mockOidcService,
    getOidcService: vi.fn(async () => mockOidcService as OidcService),
    getUserByOidcSubject: vi.fn(async () => null),
    getUserByEmail: vi.fn(async () => null),
    getUserByUsername: vi.fn(async () => null),
    createUser: vi.fn(async (data: { username: string }) => ({
      id: 1,
      username: data.username,
    })),
    getUserCount: vi.fn(async () => 0),
    updateUser: vi.fn(async () => {}),
    ...overrides,
  }
}

function createTestApp(deps: ReturnType<typeof makeDeps>) {
  const app = new Hono()
  app.route('/', oidcRoutes(deps))
  return app
}

beforeEach(async () => {
  vi.clearAllMocks()
  await clearAllSessions()
})

afterEach(async () => {
  await clearAllSessions()
})

describe('GET /api/auth/oidc/login', () => {
  it('redirects to OIDC provider (302)', async () => {
    const deps = makeDeps()
    const app = createTestApp(deps)

    const res = await app.request('/api/auth/oidc/login')

    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe(
      'https://idp.example.com/authorize?state=abc&code_challenge=xyz',
    )
    expect(deps.mockOidcService.getAuthorizationUrl).toHaveBeenCalledWith(
      'http://localhost:3000/api/auth/oidc/callback',
    )
  })
})

describe('GET /api/auth/oidc/callback', () => {
  it('creates a new user and redirects with token', async () => {
    const deps = makeDeps()
    const app = createTestApp(deps)

    const res = await app.request('/api/auth/oidc/callback?state=abc&code=auth-code-123')

    expect(res.status).toBe(302)
    const location = res.headers.get('Location')
    expect(location).toContain('oidc_token=mock-session-token-123')
    expect(deps.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'alice',
        oidcSubject: 'oidc-subject-123',
        email: 'alice@example.com',
        authProvider: 'oidc',
        isAdmin: true, // first user
      }),
    )
    expect(createSession).toHaveBeenCalledWith(1, 'mock-session-token-123')
  })

  it('matches existing user by OIDC subject (no createUser call)', async () => {
    const deps = makeDeps({
      getUserByOidcSubject: vi.fn(async () => ({
        id: 42,
        username: 'existing-alice',
      })),
    })
    const app = createTestApp(deps)

    const res = await app.request('/api/auth/oidc/callback?state=abc&code=auth-code-123')

    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toContain('oidc_token=mock-session-token-123')
    expect(deps.createUser).not.toHaveBeenCalled()
    expect(deps.getUserByEmail).not.toHaveBeenCalled()
    expect(createSession).toHaveBeenCalledWith(42, 'mock-session-token-123')
  })

  it('matches existing user by email and links OIDC subject', async () => {
    const deps = makeDeps({
      getUserByEmail: vi.fn(async () => ({
        id: 10,
        username: 'email-user',
      })),
    })
    const app = createTestApp(deps)

    const res = await app.request('/api/auth/oidc/callback?state=abc&code=auth-code-123')

    expect(res.status).toBe(302)
    expect(deps.updateUser).toHaveBeenCalledWith(10, {
      oidcSubject: 'oidc-subject-123',
    })
    expect(deps.createUser).not.toHaveBeenCalled()
    expect(createSession).toHaveBeenCalledWith(10, 'mock-session-token-123')
  })

  it('matches existing user by username and links OIDC subject + email', async () => {
    const deps = makeDeps({
      getUserByUsername: vi.fn(async () => ({
        id: 20,
        username: 'alice',
      })),
    })
    const app = createTestApp(deps)

    const res = await app.request('/api/auth/oidc/callback?state=abc&code=auth-code-123')

    expect(res.status).toBe(302)
    expect(deps.updateUser).toHaveBeenCalledWith(20, {
      oidcSubject: 'oidc-subject-123',
      email: 'alice@example.com',
    })
    expect(deps.createUser).not.toHaveBeenCalled()
    expect(createSession).toHaveBeenCalledWith(20, 'mock-session-token-123')
  })

  it('creates non-admin user when users already exist', async () => {
    const deps = makeDeps({
      getUserCount: vi.fn(async () => 3),
    })
    const app = createTestApp(deps)

    const res = await app.request('/api/auth/oidc/callback?state=abc&code=auth-code-123')

    expect(res.status).toBe(302)
    expect(deps.createUser).toHaveBeenCalledWith(expect.objectContaining({ isAdmin: false }))
  })

  it('falls back to email prefix for username when preferredUsername is absent', async () => {
    const deps = makeDeps()
    deps.mockOidcService.handleCallback.mockResolvedValue({
      claims: {
        sub: 'oidc-subject-456',
        email: 'bob@example.com',
        name: 'Bob',
      },
      accessToken: 'at',
      expiresIn: 3600,
    })
    const app = createTestApp(deps)

    await app.request('/api/auth/oidc/callback?state=abc&code=auth-code-123')

    expect(deps.createUser).toHaveBeenCalledWith(expect.objectContaining({ username: 'bob' }))
  })

  it('falls back to oidc-{sub} when no username or email', async () => {
    const deps = makeDeps()
    deps.mockOidcService.handleCallback.mockResolvedValue({
      claims: {
        sub: 'abcdefghijklmnop',
      },
      accessToken: 'at',
      expiresIn: 3600,
    })
    const app = createTestApp(deps)

    await app.request('/api/auth/oidc/callback?state=abc&code=auth-code-123')

    expect(deps.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'oidc-abcdefgh' }),
    )
  })

  it('handles errors and redirects with oidc_error', async () => {
    const deps = makeDeps()
    deps.mockOidcService.handleCallback.mockRejectedValue(
      new Error('Unknown or expired OIDC state'),
    )
    const app = createTestApp(deps)

    const res = await app.request('/api/auth/oidc/callback?state=bad&code=auth-code-123')

    expect(res.status).toBe(302)
    const location = res.headers.get('Location')
    expect(location).toContain('oidc_error=')
    expect(location).toContain('Unknown%20or%20expired%20OIDC%20state')
    expect(deps.createUser).not.toHaveBeenCalled()
  })

  it('handles non-Error thrown values', async () => {
    const deps = makeDeps()
    deps.mockOidcService.handleCallback.mockRejectedValue('string-error')
    const app = createTestApp(deps)

    const res = await app.request('/api/auth/oidc/callback?state=bad&code=auth-code-123')

    expect(res.status).toBe(302)
    const location = res.headers.get('Location')
    expect(location).toContain('oidc_error=OIDC%20authentication%20failed')
  })
})
