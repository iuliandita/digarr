// @vitest-environment node

import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateSessionToken } from '@/core/auth'
import {
  createSession,
  deleteSession,
  replaceSession,
  SessionRotationConflictError,
} from '@/core/sessions'
import {
  clearSessionCookie,
  cookieModeRequested,
  issueSession,
  prepareSessionCookie,
} from '@/server/helpers/session-auth'
import {
  SESSION_COOKIE_NAME,
  type SessionCookieOptions,
  sessionCookieOptions,
} from '@/server/middleware/session-cookie'
import type { HonoEnv } from '@/server/types'

const envConfig = vi.hoisted(() => ({
  allowedOrigin: undefined as string | undefined,
  allowInsecureCookies: false,
}))

vi.mock('@/config/env', () => ({ envConfig }))
vi.mock('@/core/auth', () => ({
  generateSessionToken: vi.fn(() => 'new-session-token'),
}))
vi.mock('@/core/sessions', () => {
  class MockSessionRotationConflictError extends Error {}
  return {
    createSession: vi.fn(async () => {}),
    deleteSession: vi.fn(async () => {}),
    replaceSession: vi.fn(async () => {}),
    SessionRotationConflictError: MockSessionRotationConflictError,
  }
})

async function optionsFor(
  allowedOrigin: string | undefined,
  requestUrl: string,
  headers?: Record<string, string>,
): Promise<SessionCookieOptions> {
  envConfig.allowedOrigin = allowedOrigin
  let captured: SessionCookieOptions | undefined
  const app = new Hono<HonoEnv>()
  app.get('/test', (c) => {
    captured = sessionCookieOptions(c, 60)
    return c.body(null, 204)
  })
  await app.request(requestUrl, { headers })
  if (!captured) throw new Error('cookie options were not captured')
  return captured
}

async function optionsErrorFor(allowedOrigin: string, requestUrl: string): Promise<unknown> {
  envConfig.allowedOrigin = allowedOrigin
  let capturedError: unknown
  const app = new Hono<HonoEnv>()
  app.get('/test', (c) => {
    try {
      sessionCookieOptions(c, 60)
    } catch (error) {
      capturedError = error
    }
    return c.body(null, 204)
  })
  await app.request(requestUrl)
  return capturedError
}

describe('sessionCookieOptions', () => {
  let previousNodeEnv: string | undefined

  beforeEach(() => {
    previousNodeEnv = process.env.NODE_ENV
    envConfig.allowInsecureCookies = false
  })

  afterEach(() => {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousNodeEnv
  })

  it.each([
    [undefined, 'http://internal/test', false, true],
    ['http://app.example.com', 'http://internal/test', false, true],
    ['http://app.example.com', 'http://internal/test', true, false],
    ['https://app.example.com', 'http://internal/test', true, true],
  ] as const)(
    'uses secure production defaults',
    async (allowedOrigin, requestUrl, allowInsecureCookies, secure) => {
      process.env.NODE_ENV = 'production'
      envConfig.allowInsecureCookies = allowInsecureCookies
      await expect(optionsFor(allowedOrigin, requestUrl)).resolves.toMatchObject({ secure })
    },
  )

  it('derives Secure from the public origin protocol outside production', async () => {
    process.env.NODE_ENV = 'development'
    envConfig.allowInsecureCookies = true
    await expect(
      optionsFor('http://app.example.com', 'https://internal/test'),
    ).resolves.toMatchObject({ secure: false })
  })

  it('does not trust X-Forwarded-Proto when deriving Secure', async () => {
    await expect(
      optionsFor(undefined, 'http://app.example.com/test', {
        'X-Forwarded-Proto': 'https',
      }),
    ).resolves.toMatchObject({ secure: false })
  })

  it.each(['not a URL', 'file:///tmp/app', 'data:text/plain,hello', 'mailto:user@example.com'])(
    'rejects invalid or non-HTTP(S) configured origin %s',
    async (allowedOrigin) => {
      await expect(optionsErrorFor(allowedOrigin, 'https://internal/test')).resolves.toBeInstanceOf(
        TypeError,
      )
    },
  )

  it('does not fall back to an HTTPS request URL when the configured origin is invalid', async () => {
    await expect(
      optionsErrorFor('app.example.com', 'https://internal/test'),
    ).resolves.toBeInstanceOf(TypeError)
  })
})

describe('session auth helpers', () => {
  beforeEach(() => {
    envConfig.allowedOrigin = undefined
    envConfig.allowInsecureCookies = false
    vi.clearAllMocks()
    vi.mocked(generateSessionToken).mockReturnValue('new-session-token')
  })

  it('creates a session, deduplicates explicit revocations, and preserves other sessions', async () => {
    envConfig.allowedOrigin = 'https://app.example.com'
    const app = new Hono<HonoEnv>()
    app.get('/test', async (c) => {
      const token = await issueSession(c, 7, {
        kind: 'create',
        cookie: prepareSessionCookie(c),
        revokeTokens: ['old-token', 'old-token', 'new-session-token'],
      })
      return c.json({ token })
    })

    const res = await app.request('http://app.example.com/test')

    expect(createSession).toHaveBeenCalledWith(7, 'new-session-token')
    expect(deleteSession).toHaveBeenCalledTimes(1)
    expect(deleteSession).toHaveBeenCalledWith('old-token')
    expect(vi.mocked(deleteSession).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(createSession).mock.invocationCallOrder[0] ?? 0,
    )
    expect(replaceSession).not.toHaveBeenCalled()
    expect(res.headers.get('set-cookie')).toContain(`${SESSION_COOKIE_NAME}=new-session-token`)
    expect(res.headers.get('cache-control')).toBe('no-store')
    await expect(res.json()).resolves.toEqual({ token: 'new-session-token' })
  })

  it.each(['create', 'rotate'] as const)(
    'validates cookie options before %s token generation or session mutation',
    async (mode) => {
      envConfig.allowedOrigin = 'app.example.com'
      let capturedError: unknown
      const app = new Hono<HonoEnv>()
      app.get('/test', async (c) => {
        try {
          if (mode === 'create') {
            const cookie = prepareSessionCookie(c)
            await issueSession(c, 7, {
              kind: 'create',
              cookie,
              revokeTokens: ['old-token'],
            })
          } else {
            const cookie = prepareSessionCookie(c)
            await issueSession(c, 7, {
              kind: 'rotate',
              cookie,
              requiredSourceToken: 'source-token',
              revokeTokens: ['old-token'],
            })
          }
        } catch (error) {
          capturedError = error
        }
        return c.body(null, 204)
      })

      const res = await app.request('https://internal/test')

      expect(capturedError).toBeInstanceOf(TypeError)
      expect(generateSessionToken).not.toHaveBeenCalled()
      expect(deleteSession).not.toHaveBeenCalled()
      expect(createSession).not.toHaveBeenCalled()
      expect(replaceSession).not.toHaveBeenCalled()
      expect(res.headers.get('set-cookie')).toBeNull()
      expect(res.headers.get('cache-control')).toBe('no-store')
    },
  )

  it('does not parse cookie configuration for cookie-free issuance', async () => {
    envConfig.allowedOrigin = 'app.example.com'
    const app = new Hono<HonoEnv>()
    app.get('/test', async (c) => {
      const token = await issueSession(c, 7, { kind: 'create', cookie: false })
      return c.json({ token })
    })

    const res = await app.request('https://internal/test')

    expect(res.status).toBe(200)
    expect(createSession).toHaveBeenCalledWith(7, 'new-session-token')
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('does not create or expose a new session when an old-token revocation fails', async () => {
    const revocationError = new Error('session revocation failed')
    vi.mocked(deleteSession).mockRejectedValueOnce(revocationError)
    let capturedError: unknown
    const app = new Hono<HonoEnv>()
    app.get('/test', async (c) => {
      const cookie = prepareSessionCookie(c)
      try {
        await issueSession(c, 7, {
          kind: 'create',
          cookie,
          revokeTokens: ['old-token'],
        })
      } catch (error) {
        capturedError = error
      }
      return c.body(null, 204)
    })

    const res = await app.request('http://app.example.com/test')

    expect(capturedError).toBe(revocationError)
    expect(createSession).not.toHaveBeenCalled()
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('creates a request-aware HttpOnly cookie when requested', async () => {
    envConfig.allowedOrigin = 'https://app.example.com'
    const app = new Hono<HonoEnv>()
    app.get('/test', async (c) => {
      await issueSession(c, 7, { kind: 'create', cookie: prepareSessionCookie(c) })
      return c.body(null, 204)
    })

    const res = await app.request('http://internal/test')

    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('set-cookie')).toMatch(
      /^digarr_session=new-session-token; Max-Age=2592000; Path=\/; HttpOnly; Secure; SameSite=Lax$/i,
    )
  })

  it('uses preflighted cookie options without reparsing configuration', async () => {
    envConfig.allowedOrigin = 'https://app.example.com'
    const app = new Hono<HonoEnv>()
    app.get('/test', async (c) => {
      const cookie = prepareSessionCookie(c)
      envConfig.allowedOrigin = 'file:///tmp/app'
      await issueSession(c, 7, { kind: 'create', cookie })
      return c.body(null, 204)
    })

    const res = await app.request('http://internal/test')

    expect(createSession).toHaveBeenCalledWith(7, 'new-session-token')
    expect(res.headers.get('set-cookie')).toMatch(/; HttpOnly; Secure; SameSite=Lax$/i)
  })

  it('rotates through the mandatory source-token CAS', async () => {
    const app = new Hono<HonoEnv>()
    app.get('/test', async (c) => {
      const token = await issueSession(c, 9, {
        kind: 'rotate',
        cookie: false,
        requiredSourceToken: 'source-token',
        revokeTokens: ['stale-cookie'],
      })
      return c.json({ token })
    })

    const res = await app.request('http://app.example.com/test')

    expect(replaceSession).toHaveBeenCalledWith(9, 'new-session-token', 'source-token', [
      'stale-cookie',
    ])
    expect(createSession).not.toHaveBeenCalled()
    expect(deleteSession).not.toHaveBeenCalled()
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('propagates a session rotation conflict without creating a fallback session', async () => {
    const conflict = new SessionRotationConflictError()
    vi.mocked(replaceSession).mockRejectedValueOnce(conflict)
    let capturedError: unknown
    const app = new Hono<HonoEnv>()
    app.get('/test', async (c) => {
      try {
        const cookie = prepareSessionCookie(c)
        await issueSession(c, 9, {
          kind: 'rotate',
          cookie,
          requiredSourceToken: 'source-token',
        })
      } catch (error) {
        capturedError = error
      }
      return c.body(null, 204)
    })

    const res = await app.request('http://app.example.com/test')

    expect(capturedError).toBe(conflict)
    expect(createSession).not.toHaveBeenCalled()
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('requires the exact cookie-mode header value', async () => {
    const results: boolean[] = []
    const app = new Hono<HonoEnv>()
    app.get('/test', (c) => {
      results.push(cookieModeRequested(c))
      return c.body(null, 204)
    })

    await app.request('/test', { headers: { 'X-Digarr-Auth-Mode': 'cookie' } })
    await app.request('/test', { headers: { 'X-Digarr-Auth-Mode': 'Cookie' } })
    await app.request('/test', { headers: { 'X-Digarr-Auth-Mode': 'cookie-mode' } })
    await app.request('/test')

    expect(results).toEqual([true, false, false, false])
  })

  it('clears only the shared session cookie path', async () => {
    const app = new Hono<HonoEnv>()
    app.get('/test', (c) => {
      clearSessionCookie(c)
      return c.body(null, 204)
    })

    const res = await app.request('/test')

    expect(res.headers.get('set-cookie')).toContain(`${SESSION_COOKIE_NAME}=;`)
    expect(res.headers.get('set-cookie')).toContain('Path=/')
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0')
  })
})
