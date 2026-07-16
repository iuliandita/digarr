// @vitest-environment node

import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OidcService } from '@/core/auth/oidc'
import { clearAllSessions, createSession, getSession } from '@/core/sessions'
import { oidcRoutes } from '@/server/routes/oidc'

const envConfig = vi.hoisted(() => ({
  allowedOrigin: 'http://localhost:3000' as string | undefined,
}))

vi.mock('@/config/env', () => ({ envConfig }))

vi.mock('@/core/auth', () => ({
  generateSessionToken: vi.fn(() => 'mock-session-token-123'),
  hashPassword: vi.fn(() => 'mocked-hash'),
}))

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
  envConfig.allowedOrigin = 'http://localhost:3000'
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
  it('creates a new user and redirects with an HttpOnly cookie only', async () => {
    const deps = makeDeps()
    const app = createTestApp(deps)

    const res = await app.request('/api/v1/auth/oidc/callback?state=abc&code=auth-code-123')

    expect(res.status).toBe(302)
    const location = res.headers.get('Location')
    expect(location).toBe('/')
    expect(location).not.toContain('token')
    expect(location).not.toContain('access_token')
    expect(location).not.toContain('mock-session-token-123')
    expect(location).not.toContain(encodeURIComponent('mock-session-token-123'))
    expect(res.headers.get('set-cookie')).toMatch(
      /^digarr_session=mock-session-token-123; Max-Age=2592000; Path=\/; HttpOnly; SameSite=Lax$/i,
    )
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(deps.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'alice',
        oidcSubject: 'oidc-subject-123',
        email: 'alice@example.com',
        authProvider: 'oidc',
        isAdmin: true, // first user
      }),
    )
    await expect(getSession('mock-session-token-123')).resolves.toEqual({ userId: 1 })
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
    expect(res.headers.get('Location')).toBe('/')
    expect(res.headers.get('set-cookie')).toContain('digarr_session=mock-session-token-123')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(deps.createUser).not.toHaveBeenCalled()
    await expect(getSession('mock-session-token-123')).resolves.toEqual({ userId: 42 })
  })

  it('replaces the existing browser cookie session and preserves another device session', async () => {
    await createSession(42, 'old-browser-session')
    await createSession(42, 'other-device-session')
    const deps = makeDeps({
      getUserByOidcSubject: vi.fn(async () => ({
        id: 42,
        username: 'existing-alice',
      })),
    })
    const app = createTestApp(deps)

    const res = await app.request('/api/v1/auth/oidc/callback?state=abc&code=auth-code-123', {
      headers: { Cookie: 'digarr_session=old-browser-session' },
    })

    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('/')
    expect(res.headers.get('set-cookie')).toContain('digarr_session=mock-session-token-123')
    await expect(getSession('old-browser-session')).resolves.toBeNull()
    await expect(getSession('mock-session-token-123')).resolves.toEqual({ userId: 42 })
    await expect(getSession('other-device-session')).resolves.toEqual({ userId: 42 })
  })

  it('sets Secure when the configured public origin uses HTTPS', async () => {
    envConfig.allowedOrigin = 'https://app.example.com'
    const deps = makeDeps({
      getUserByOidcSubject: vi.fn(async () => ({ id: 42, username: 'existing-alice' })),
    })
    const app = createTestApp(deps)

    const res = await app.request('/api/v1/auth/oidc/callback?state=abc&code=auth-code-123')

    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('/')
    expect(res.headers.get('set-cookie')).toMatch(/; HttpOnly; Secure; SameSite=Lax$/i)
    expect(res.headers.get('cache-control')).toBe('no-store')
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
    await expect(getSession('mock-session-token-123')).resolves.toEqual({ userId: 1 })
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
      new Error('Unknown state with access_token=provider-secret'),
    )
    const app = createTestApp(deps)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const res = await app.request('/api/v1/auth/oidc/callback?state=bad&code=auth-code-123')

    expect(res.status).toBe(302)
    const location = res.headers.get('Location')
    expect(location).toBe('/#oidc_error=oidc_failed')
    // IdP-sourced error strings must not echo into the frontend URL.
    expect(location).not.toContain('Unknown')
    expect(location).not.toContain('provider-secret')
    expect(location).not.toContain('access_token')
    expect(warn.mock.calls.flat().join(' ')).not.toContain('provider-secret')
    expect(warn.mock.calls.flat().join(' ')).not.toContain('access_token')
    expect(deps.createUser).not.toHaveBeenCalled()
  })

  it('preserves the old cookie session when cookie configuration is invalid', async () => {
    envConfig.allowedOrigin = 'file:///tmp/app'
    await createSession(42, 'old-browser-session')
    await createSession(42, 'other-device-session')
    const deps = makeDeps({
      getUserByOidcSubject: vi.fn(async () => ({ id: 42, username: 'existing-alice' })),
    })
    const app = createTestApp(deps)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const res = await app.request('/api/v1/auth/oidc/callback?state=abc&code=auth-code-123', {
      headers: { Cookie: 'digarr_session=old-browser-session' },
    })

    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('/#oidc_error=oidc_failed')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(res.headers.get('cache-control')).toBe('no-store')
    await expect(getSession('old-browser-session')).resolves.toEqual({ userId: 42 })
    await expect(getSession('other-device-session')).resolves.toEqual({ userId: 42 })
    expect(warn).toHaveBeenCalled()
  })

  it('rejects invalid cookie configuration before provisioning an OIDC user', async () => {
    envConfig.allowedOrigin = 'file:///tmp/app'
    const deps = makeDeps()
    const app = createTestApp(deps)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const res = await app.request('/api/v1/auth/oidc/callback?state=abc&code=auth-code-123')

    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('/#oidc_error=oidc_failed')
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(deps.createUser).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
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
