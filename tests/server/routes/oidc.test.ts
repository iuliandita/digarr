// @vitest-environment node

import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { verifyPassword } from '@/core/auth'
import { OidcCallbackError, OidcPendingCapacityError, type OidcService } from '@/core/auth/oidc'
import { clearAllSessions, createSession, getSession } from '@/core/sessions'
import { hashSessionToken } from '@/db/queries/sessions'
import { OidcIdentityInUseError } from '@/db/queries/users'
import { oidcTransactionCookieName } from '@/server/helpers/oidc-transaction-cookie'
import { oidcRoutes } from '@/server/routes/oidc'
import type { HonoEnv } from '@/server/types'

const deletionRegex = (state: string) =>
  new RegExp(`${oidcTransactionCookieName(state)}=;[^,]*Max-Age=0`, 'i')

const envConfig = vi.hoisted(() => ({
  allowedOrigin: 'http://localhost:3000' as string | undefined,
}))

vi.mock('@/config/env', () => ({ envConfig }))

vi.mock('@/core/auth', () => ({
  generateSessionToken: vi.fn(() => 'mock-session-token-123'),
  hashPassword: vi.fn(() => 'mocked-hash'),
  verifyPassword: vi.fn(() => true),
}))

function makeMockOidcService() {
  return {
    getAuthorizationUrl: vi.fn(async () => ({
      url: 'https://idp.example.com/authorize?state=abc&code_challenge=xyz',
      state: 'abc',
      browserBinding: 'binding-abc',
    })),
    handleCallback: vi.fn(async () => ({
      purpose: { kind: 'login' as const },
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
    getUserCredentialsById: vi.fn(async () => ({
      id: 7,
      username: 'local-user',
      passwordHash: 'stored-password-hash',
      authProvider: 'local',
      oidcSubject: null,
    })),
    createUser: vi.fn(async (data: { username: string }) => ({
      id: 1,
      username: data.username,
    })),
    linkOidcIdentity: vi.fn(async () => {}),
    ...overrides,
  }
}

function createTestApp(deps: ReturnType<typeof makeDeps>) {
  const app = new Hono<HonoEnv>()
  app.use('/api/v1/auth/oidc/link', async (c, next) => {
    c.set('userId', 7)
    c.set('authMethod', 'session-cookie')
    await next()
  })
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
      { kind: 'login' },
    )
  })

  it('sets a state-derived HttpOnly transaction cookie holding the browser binding', async () => {
    const deps = makeDeps()
    const app = createTestApp(deps)

    const res = await app.request('/api/v1/auth/oidc/login')

    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain(`${oidcTransactionCookieName('abc')}=binding-abc`)
    expect(setCookie).toMatch(/HttpOnly/i)
    expect(setCookie).toMatch(/SameSite=Lax/i)
    expect(setCookie).toMatch(/Path=\/api\/v1\/auth\/oidc\/callback/i)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('uses independent cookie names for concurrent login flows (multi-tab)', async () => {
    const deps = makeDeps()
    let n = 0
    deps.mockOidcService.getAuthorizationUrl.mockImplementation(async () => {
      n += 1
      return {
        url: `https://idp/authorize?state=s${n}`,
        state: `s${n}`,
        browserBinding: `bind-${n}`,
      }
    })
    const app = createTestApp(deps)

    const first = await app.request('/api/v1/auth/oidc/login')
    const second = await app.request('/api/v1/auth/oidc/login')

    expect(first.headers.get('set-cookie') ?? '').toContain(
      `${oidcTransactionCookieName('s1')}=bind-1`,
    )
    expect(second.headers.get('set-cookie') ?? '').toContain(
      `${oidcTransactionCookieName('s2')}=bind-2`,
    )
    expect(oidcTransactionCookieName('s1')).not.toBe(oidcTransactionCookieName('s2'))
  })

  it('returns 503 with Retry-After and no transaction cookie at capacity', async () => {
    const deps = makeDeps()
    deps.mockOidcService.getAuthorizationUrl.mockRejectedValue(new OidcPendingCapacityError())
    const app = createTestApp(deps)

    const res = await app.request('/api/v1/auth/oidc/login')

    expect(res.status).toBe(503)
    expect(res.headers.get('Retry-After')).toBe('60')
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('allocates no pending state when cookie configuration is invalid', async () => {
    envConfig.allowedOrigin = 'file:///tmp/app'
    const deps = makeDeps()
    const app = createTestApp(deps)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const res = await app.request('/api/v1/auth/oidc/login')

    expect(res.status).toBe(500)
    expect(deps.mockOidcService.getAuthorizationUrl).not.toHaveBeenCalled()
    expect(res.headers.get('set-cookie')).toBeNull()
    warn.mockRestore()
  })
})

describe('POST /api/v1/auth/oidc/link', () => {
  const requestLink = (app: Hono<HonoEnv>, token = 'link-session') =>
    app.request('/api/v1/auth/oidc/link', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `digarr_session=${token}`,
      },
      body: JSON.stringify({ currentPassword: 'correct-password' }),
    })

  it('returns an authorization URL bound to the user, password, and cookie session', async () => {
    const deps = makeDeps()
    const app = createTestApp(deps)

    const res = await requestLink(app)

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      url: 'https://idp.example.com/authorize?state=abc&code_challenge=xyz',
    })
    expect(deps.mockOidcService.getAuthorizationUrl).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/auth/oidc/callback',
      {
        kind: 'link',
        userId: 7,
        sessionHash: hashSessionToken('link-session'),
        passwordFingerprint: expect.any(String),
      },
    )
    expect(res.headers.get('set-cookie')).toContain(`${oidcTransactionCookieName('abc')}=`)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('rejects a wrong current password without allocating OIDC state', async () => {
    vi.mocked(verifyPassword).mockReturnValueOnce(false)
    const deps = makeDeps()
    const app = createTestApp(deps)

    const res = await requestLink(app)

    expect(res.status).toBe(403)
    expect(deps.mockOidcService.getAuthorizationUrl).not.toHaveBeenCalled()
  })

  it('rejects an account that is already linked', async () => {
    const deps = makeDeps({
      getUserCredentialsById: vi.fn(async () => ({
        id: 7,
        username: 'local-user',
        passwordHash: 'stored-password-hash',
        authProvider: 'local',
        oidcSubject: 'existing-subject',
      })),
    })
    const app = createTestApp(deps)

    const res = await requestLink(app)

    expect(res.status).toBe(409)
    expect(deps.mockOidcService.getAuthorizationUrl).not.toHaveBeenCalled()
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
    expect(res.headers.get('set-cookie')).toContain(
      'digarr_session=mock-session-token-123; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax',
    )
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(deps.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'alice',
        oidcSubject: 'oidc-subject-123',
        email: 'alice@example.com',
        authProvider: 'oidc',
      }),
      { bootstrap: 'allow-existing' },
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
    expect(deps.linkOidcIdentity).not.toHaveBeenCalled()
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
    expect(deps.linkOidcIdentity).not.toHaveBeenCalled()
    expect(deps.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'alice-oidc-sub' }),
      { bootstrap: 'allow-existing' },
    )
  })

  it('sanitizes malicious preferredUsername claims', async () => {
    const deps = makeDeps()
    deps.mockOidcService.handleCallback.mockResolvedValue({
      purpose: { kind: 'login' },
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
      { bootstrap: 'allow-existing' },
    )
  })

  it('lowercases the email claim before creating the user', async () => {
    // Local registration and getUserByEmail lowercase; the unique index is
    // case-sensitive, so a raw mixed-case claim would create an account
    // invisible to email lookups and allow same-email duplicates.
    const deps = makeDeps()
    deps.mockOidcService.handleCallback.mockResolvedValue({
      purpose: { kind: 'login' },
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
      { bootstrap: 'allow-existing' },
    )
  })

  it('delegates admin selection to atomic bootstrap', async () => {
    const deps = makeDeps()
    const app = createTestApp(deps)

    const res = await app.request('/api/v1/auth/oidc/callback?state=abc&code=auth-code-123')

    expect(res.status).toBe(302)
    expect(deps.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ authProvider: 'oidc' }),
      { bootstrap: 'allow-existing' },
    )
  })

  it('falls back to email prefix for username when preferredUsername is absent', async () => {
    const deps = makeDeps()
    deps.mockOidcService.handleCallback.mockResolvedValue({
      purpose: { kind: 'login' },
      claims: {
        sub: 'oidc-subject-456',
        email: 'bob@example.com',
        name: 'Bob',
      },
    })
    const app = createTestApp(deps)

    await app.request('/api/v1/auth/oidc/callback?state=abc&code=auth-code-123')

    expect(deps.createUser).toHaveBeenCalledWith(expect.objectContaining({ username: 'bob' }), {
      bootstrap: 'allow-existing',
    })
  })

  it('falls back to oidc-{sub} when no username or email', async () => {
    const deps = makeDeps()
    deps.mockOidcService.handleCallback.mockResolvedValue({
      purpose: { kind: 'login' },
      claims: {
        sub: 'abcdefghijklmnop',
      },
    })
    const app = createTestApp(deps)

    await app.request('/api/v1/auth/oidc/callback?state=abc&code=auth-code-123')

    expect(deps.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'oidc-abcdefgh' }),
      { bootstrap: 'allow-existing' },
    )
  })

  it('links the validated identity without issuing or rotating a session', async () => {
    const deps = makeDeps()
    deps.mockOidcService.handleCallback.mockResolvedValue({
      purpose: {
        kind: 'link',
        userId: 7,
        sessionHash: hashSessionToken('link-session'),
        passwordFingerprint: 'password-fingerprint',
      },
      claims: { sub: 'new-oidc-subject' },
    })
    const app = createTestApp(deps)

    const res = await app.request('/api/v1/auth/oidc/callback?state=abc&code=auth-code-123', {
      headers: {
        Cookie: `${oidcTransactionCookieName('abc')}=binding-abc; digarr_session=link-session`,
      },
    })

    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('/settings?tab=account&oidc_link=success')
    expect(deps.linkOidcIdentity).toHaveBeenCalledWith({
      userId: 7,
      oidcSubject: 'new-oidc-subject',
      passwordFingerprint: 'password-fingerprint',
      initiatingSessionHash: hashSessionToken('link-session'),
      presentedSessionHash: hashSessionToken('link-session'),
    })
    expect(deps.createUser).not.toHaveBeenCalled()
    expect(res.headers.get('set-cookie')).not.toContain('digarr_session=mock-session-token-123')
    await expect(getSession('mock-session-token-123')).resolves.toBeNull()
  })

  it('returns the fixed link failure redirect when the initiating session is stale', async () => {
    const deps = makeDeps({
      linkOidcIdentity: vi.fn(async () => {
        throw new Error('stale session details must not escape')
      }),
    })
    deps.mockOidcService.handleCallback.mockResolvedValue({
      purpose: {
        kind: 'link',
        userId: 7,
        sessionHash: hashSessionToken('old-session'),
        passwordFingerprint: 'password-fingerprint',
      },
      claims: { sub: 'new-oidc-subject' },
    })
    const app = createTestApp(deps)

    const res = await app.request('/api/v1/auth/oidc/callback?state=abc&code=auth-code-123', {
      headers: {
        Cookie: `${oidcTransactionCookieName('abc')}=binding-abc; digarr_session=new-session`,
      },
    })

    expect(res.headers.get('Location')).toBe('/settings?tab=account&oidc_link=failed')
    expect(res.headers.get('Location')).not.toContain('stale')
  })

  it('returns the fixed identity collision redirect', async () => {
    const deps = makeDeps({
      linkOidcIdentity: vi.fn(async () => {
        throw new OidcIdentityInUseError()
      }),
    })
    deps.mockOidcService.handleCallback.mockResolvedValue({
      purpose: {
        kind: 'link',
        userId: 7,
        sessionHash: hashSessionToken('link-session'),
        passwordFingerprint: 'password-fingerprint',
      },
      claims: { sub: 'claimed-subject' },
    })
    const app = createTestApp(deps)

    const res = await app.request('/api/v1/auth/oidc/callback?state=abc&code=auth-code-123', {
      headers: {
        Cookie: `${oidcTransactionCookieName('abc')}=binding-abc; digarr_session=link-session`,
      },
    })

    expect(res.headers.get('Location')).toBe('/settings?tab=account&oidc_link=identity_in_use')
  })

  it('returns the account failure notice when a recognized link transaction fails validation', async () => {
    const purpose = {
      kind: 'link' as const,
      userId: 7,
      sessionHash: hashSessionToken('link-session'),
      passwordFingerprint: 'password-fingerprint',
    }
    const deps = makeDeps()
    deps.mockOidcService.handleCallback.mockRejectedValue(
      new OidcCallbackError(purpose, 'provider denied the request'),
    )
    const app = createTestApp(deps)

    const res = await app.request('/api/v1/auth/oidc/callback?state=abc&error=access_denied')

    expect(res.headers.get('Location')).toBe('/settings?tab=account&oidc_link=failed')
    expect(deps.linkOidcIdentity).not.toHaveBeenCalled()
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
    // No new browser session is issued; only the identified transaction cookie is cleared.
    expect(res.headers.get('set-cookie')).not.toContain('digarr_session')
    expect(res.headers.get('set-cookie')).toMatch(deletionRegex('abc'))
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
    expect(res.headers.get('set-cookie')).not.toContain('digarr_session')
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

  describe('browser binding', () => {
    // Mock the service so the binding it receives decides success: this proves
    // the ROUTE reads the state-derived cookie and forwards it to handleCallback.
    function bindingEnforcingDeps(overrides: Record<string, unknown> = {}) {
      const deps = makeDeps(overrides)
      deps.mockOidcService.handleCallback.mockImplementation(
        async (_url: URL, binding?: string) => {
          if (binding !== 'binding-abc') {
            throw new Error('Unknown, expired, or invalid OIDC transaction')
          }
          return {
            purpose: { kind: 'login' },
            claims: {
              sub: 'oidc-subject-123',
              email: 'alice@example.com',
              emailVerified: true,
              preferredUsername: 'alice',
            },
          }
        },
      )
      return deps
    }

    const cookieHeader = (state: string, value: string) => ({
      Cookie: `${oidcTransactionCookieName(state)}=${value}`,
    })

    it('accepts the matching transaction cookie and deletes it', async () => {
      const deps = bindingEnforcingDeps()
      const app = createTestApp(deps)

      const res = await app.request('/api/v1/auth/oidc/callback?state=abc&code=auth-code-123', {
        headers: cookieHeader('abc', 'binding-abc'),
      })

      expect(res.status).toBe(302)
      expect(res.headers.get('Location')).toBe('/')
      expect(deps.mockOidcService.handleCallback).toHaveBeenCalledWith(
        expect.any(URL),
        'binding-abc',
      )
      const setCookie = res.headers.get('set-cookie') ?? ''
      expect(setCookie).toContain('digarr_session=mock-session-token-123')
      expect(setCookie).toMatch(deletionRegex('abc'))
      await expect(getSession('mock-session-token-123')).resolves.toEqual({ userId: 1 })
    })

    it('rejects a callback with no transaction cookie (no exchange, no user, no session)', async () => {
      const deps = bindingEnforcingDeps()
      const app = createTestApp(deps)
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const res = await app.request('/api/v1/auth/oidc/callback?state=abc&code=auth-code-123')

      expect(res.headers.get('Location')).toBe('/#oidc_error=oidc_failed')
      expect(deps.mockOidcService.handleCallback).toHaveBeenCalledWith(expect.any(URL), undefined)
      expect(deps.createUser).not.toHaveBeenCalled()
      expect(res.headers.get('set-cookie')).not.toContain('digarr_session')
      await expect(getSession('mock-session-token-123')).resolves.toBeNull()
      warn.mockRestore()
    })

    it('rejects a callback whose transaction cookie value is wrong', async () => {
      const deps = bindingEnforcingDeps()
      const app = createTestApp(deps)
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const res = await app.request('/api/v1/auth/oidc/callback?state=abc&code=auth-code-123', {
        headers: cookieHeader('abc', 'not-the-binding'),
      })

      expect(res.headers.get('Location')).toBe('/#oidc_error=oidc_failed')
      expect(deps.createUser).not.toHaveBeenCalled()
      expect(res.headers.get('set-cookie')).not.toContain('digarr_session')
      warn.mockRestore()
    })

    it('rejects an attacker state presented with another transaction cookie', async () => {
      const deps = bindingEnforcingDeps()
      const app = createTestApp(deps)
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

      // Browser holds a cookie for the victim's flow; attacker forces a foreign state.
      const res = await app.request(
        '/api/v1/auth/oidc/callback?state=attacker&code=auth-code-123',
        { headers: cookieHeader('victim', 'binding-abc') },
      )

      expect(res.headers.get('Location')).toBe('/#oidc_error=oidc_failed')
      expect(deps.mockOidcService.handleCallback).toHaveBeenCalledWith(expect.any(URL), undefined)
      expect(deps.createUser).not.toHaveBeenCalled()
      warn.mockRestore()
    })

    it('rejects replay of an already-consumed transaction', async () => {
      const deps = makeDeps()
      deps.mockOidcService.handleCallback
        .mockResolvedValueOnce({
          purpose: { kind: 'login' },
          claims: { sub: 'oidc-subject-123', preferredUsername: 'alice' },
        })
        .mockRejectedValue(new Error('Unknown, expired, or invalid OIDC transaction'))
      const app = createTestApp(deps)
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const first = await app.request('/api/v1/auth/oidc/callback?state=abc&code=auth-code-123', {
        headers: cookieHeader('abc', 'binding-abc'),
      })
      expect(first.headers.get('Location')).toBe('/')

      const second = await app.request('/api/v1/auth/oidc/callback?state=abc&code=auth-code-123', {
        headers: cookieHeader('abc', 'binding-abc'),
      })
      expect(second.headers.get('Location')).toBe('/#oidc_error=oidc_failed')
      warn.mockRestore()
    })

    it('deletes the transaction cookie on provider failure', async () => {
      const deps = makeDeps()
      deps.mockOidcService.handleCallback.mockRejectedValue(new Error('provider boom'))
      const app = createTestApp(deps)
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const res = await app.request('/api/v1/auth/oidc/callback?state=abc&code=auth-code-123', {
        headers: cookieHeader('abc', 'binding-abc'),
      })

      expect(res.headers.get('Location')).toBe('/#oidc_error=oidc_failed')
      expect(res.headers.get('set-cookie')).toMatch(deletionRegex('abc'))
      warn.mockRestore()
    })

    it('deletes the transaction cookie on provisioning failure', async () => {
      const deps = makeDeps({
        createUser: vi.fn(async () => {
          throw new Error('db down')
        }),
      })
      const app = createTestApp(deps)
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const res = await app.request('/api/v1/auth/oidc/callback?state=abc&code=auth-code-123', {
        headers: cookieHeader('abc', 'binding-abc'),
      })

      expect(res.headers.get('Location')).toBe('/#oidc_error=oidc_failed')
      expect(res.headers.get('set-cookie')).toMatch(deletionRegex('abc'))
      warn.mockRestore()
    })

    it('deletes the transaction cookie on session-issuance failure', async () => {
      envConfig.allowedOrigin = 'file:///tmp/app'
      const deps = makeDeps({
        getUserByOidcSubject: vi.fn(async () => ({ id: 7, username: 'existing' })),
      })
      const app = createTestApp(deps)
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const res = await app.request('/api/v1/auth/oidc/callback?state=abc&code=auth-code-123', {
        headers: cookieHeader('abc', 'binding-abc'),
      })

      expect(res.headers.get('Location')).toBe('/#oidc_error=oidc_failed')
      expect(res.headers.get('set-cookie')).not.toContain('digarr_session')
      expect(res.headers.get('set-cookie')).toMatch(deletionRegex('abc'))
      warn.mockRestore()
    })
  })
})
