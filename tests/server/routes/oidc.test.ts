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
    envConfig: {
      ...original.envConfig,
      allowedOrigin: 'http://localhost:3000',
    },
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
        emailVerified: true,
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

describe('GET /api/v1/auth/oidc/login', () => {
  it('redirects to OIDC provider (302)', async () => {
    const deps = makeDeps()
    const app = createTestApp(deps)

    const res = await app.request('/api/v1/auth/oidc/login')

    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe(
      'https://idp.example.com/authorize?state=abc&code_challenge=xyz',
    )
    expect(deps.mockOidcService.getAuthorizationUrl).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/auth/oidc/callback',
    )
  })
})

describe('GET /api/v1/auth/oidc/callback', () => {
  it('creates a new user and redirects with token', async () => {
    const deps = makeDeps()
    const app = createTestApp(deps)

    const res = await app.request('/api/v1/auth/oidc/callback?state=abc&code=auth-code-123')

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

    const res = await app.request('/api/v1/auth/oidc/callback?state=abc&code=auth-code-123')

    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toContain('oidc_token=mock-session-token-123')
    expect(deps.createUser).not.toHaveBeenCalled()
    expect(createSession).toHaveBeenCalledWith(42, 'mock-session-token-123')
  })

  it('never links to a local account by email; matches strictly by OIDC subject', async () => {
    // An attacker could seed a local account carrying the victim's email. The
    // victim's first OIDC login must NOT auto-link into that account (pre-link
    // account takeover) -- linking is by OIDC subject only.
    const deps = makeDeps({
      getUserByEmail: vi.fn(async () => ({ id: 10, username: 'squatted-by-attacker' })),
    })
    const app = createTestApp(deps)

    const res = await app.request('/api/v1/auth/oidc/callback?state=abc&code=auth-code-123')

    expect(res.status).toBe(302)
    // The pre-seeded account is neither linked nor logged into.
    expect(deps.updateUser).not.toHaveBeenCalled()
    expect(createSession).not.toHaveBeenCalledWith(10, expect.anything())
    // A fresh account is created for this subject instead.
    expect(deps.createUser).toHaveBeenCalled()
  })

  it('does not auto-link by username alone', async () => {
    const deps = makeDeps({
      getUserByUsername: vi.fn(async () => ({
        id: 20,
        username: 'alice',
      })),
    })
    const app = createTestApp(deps)

    const res = await app.request('/api/v1/auth/oidc/callback?state=abc&code=auth-code-123')

    expect(res.status).toBe(302)
    expect(deps.updateUser).not.toHaveBeenCalled()
    expect(deps.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'alice-oidc-sub' }),
    )
  })

  it('sanitizes malicious preferredUsername claims', async () => {
    const deps = makeDeps()
    deps.mockOidcService.handleCallback.mockResolvedValue({
      claims: {
        sub: 'oidc-subject-777',
        email: 'mallory@example.com',
        emailVerified: true,
        preferredUsername: 'mallory<script>alert(1)</script>',
      },
      accessToken: 'at',
      expiresIn: 3600,
    })
    const app = createTestApp(deps)

    await app.request('/api/v1/auth/oidc/callback?state=abc&code=auth-code-123')

    expect(deps.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'malloryscriptalert1script' }),
    )
  })

  it('lowercases the email claim before creating the user', async () => {
    // Local registration and getUserByEmail lowercase; the unique index is
    // case-sensitive, so a raw mixed-case claim would create an account
    // invisible to email lookups and allow same-email duplicates.
    const deps = makeDeps()
    deps.mockOidcService.handleCallback.mockResolvedValue({
      claims: {
        sub: 'oidc-subject-999',
        email: 'Carol.MixedCase@Example.COM',
        emailVerified: true,
        preferredUsername: 'carol',
      },
      accessToken: 'at',
      expiresIn: 3600,
    })
    const app = createTestApp(deps)

    await app.request('/api/v1/auth/oidc/callback?state=abc&code=auth-code-123')

    expect(deps.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'carol.mixedcase@example.com' }),
    )
  })

  it('creates non-admin user when users already exist', async () => {
    const deps = makeDeps({
      getUserCount: vi.fn(async () => 3),
    })
    const app = createTestApp(deps)

    const res = await app.request('/api/v1/auth/oidc/callback?state=abc&code=auth-code-123')

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

    await app.request('/api/v1/auth/oidc/callback?state=abc&code=auth-code-123')

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

    await app.request('/api/v1/auth/oidc/callback?state=abc&code=auth-code-123')

    expect(deps.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'oidc-abcdefgh' }),
    )
  })

  it('handles errors and redirects with short error code (no message leak)', async () => {
    const deps = makeDeps()
    deps.mockOidcService.handleCallback.mockRejectedValue(
      new Error('Unknown or expired OIDC state'),
    )
    const app = createTestApp(deps)

    const res = await app.request('/api/v1/auth/oidc/callback?state=bad&code=auth-code-123')

    expect(res.status).toBe(302)
    const location = res.headers.get('Location')
    expect(location).toBe('/#oidc_error=oidc_failed')
    // IdP-sourced error strings must not echo into the frontend URL.
    expect(location).not.toContain('Unknown')
    expect(location).not.toContain('expired')
    expect(deps.createUser).not.toHaveBeenCalled()
  })

  it('handles non-Error thrown values with the same short error code', async () => {
    const deps = makeDeps()
    deps.mockOidcService.handleCallback.mockRejectedValue('string-error')
    const app = createTestApp(deps)

    const res = await app.request('/api/v1/auth/oidc/callback?state=bad&code=auth-code-123')

    expect(res.status).toBe(302)
    const location = res.headers.get('Location')
    expect(location).toBe('/#oidc_error=oidc_failed')
  })
})
