// @vitest-environment node

import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAllSessions, createSession } from '@/core/sessions'
import { createApp } from '@/server'
import { csrfGuard } from '@/server/middleware/csrf'
import { SESSION_COOKIE_NAME } from '@/server/middleware/session-cookie'
import type { AuthMethod, HonoEnv } from '@/server/types'
import { makeDeps } from '../../helpers/test-app'

const APP_ORIGIN = 'https://app.example.test'

vi.mock('@/config/env', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/config/env')>()
  return {
    ...original,
    envConfig: {
      ...original.envConfig,
      allowedOrigin: 'https://app.example.test',
      authToken: null,
      proxyAuthEnabled: false,
    },
  }
})

function createGuardApp(authMethod?: AuthMethod) {
  const app = new Hono<HonoEnv>()
  if (authMethod) {
    app.use('*', async (c, next) => {
      c.set('authMethod', authMethod)
      await next()
    })
  }
  app.use('*', csrfGuard)
  app.all('/api/v1/test', (c) => c.json({ ok: true }))
  app.post('/outside', (c) => c.json({ ok: true }))
  return app
}

function unsafeRequest(headers: Record<string, string> = {}, path = '/api/v1/test') {
  return new Request(`${APP_ORIGIN}${path}`, { method: 'POST', headers })
}

describe('csrf middleware policy', () => {
  it.each<AuthMethod>(['session-bearer', 'legacy-bearer'])(
    'allows verified %s auth without browser headers',
    async (authMethod) => {
      const res = await createGuardApp(authMethod).request(unsafeRequest())

      expect(res.status).toBe(200)
    },
  )

  it.each<AuthMethod>(['session-cookie', 'proxy'])(
    'allows %s auth with the CSRF header and exact same-origin evidence',
    async (authMethod) => {
      const res = await createGuardApp(authMethod).request(
        unsafeRequest({
          'X-Digarr-CSRF': '1',
          Origin: APP_ORIGIN,
          'Sec-Fetch-Site': 'same-origin',
        }),
      )

      expect(res.status).toBe(200)
    },
  )

  it.each([
    ['missing header', { Origin: APP_ORIGIN, 'Sec-Fetch-Site': 'same-origin' }],
    ['missing evidence', { 'X-Digarr-CSRF': '1' }],
    [
      'cross-site metadata',
      { 'X-Digarr-CSRF': '1', Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' },
    ],
    [
      'same-site metadata',
      { 'X-Digarr-CSRF': '1', Origin: APP_ORIGIN, 'Sec-Fetch-Site': 'same-site' },
    ],
  ])('rejects ambient auth with %s', async (_case, headers) => {
    const res = await createGuardApp('session-cookie').request(unsafeRequest(headers))

    expect(res.status).toBe(403)
  })

  it.each(['GET', 'HEAD', 'OPTIONS'])('allows the safe %s method', async (method) => {
    const app = createGuardApp('session-query')
    const res = await app.request(`${APP_ORIGIN}/api/v1/test`, { method })

    expect(res.status).toBe(200)
  })

  it('does not apply outside /api/v1/', async () => {
    const res = await createGuardApp('session-cookie').request(unsafeRequest({}, '/outside'))

    expect(res.status).toBe(200)
  })

  it('allows public browser requests with the header and exact same-origin evidence', async () => {
    const res = await createGuardApp().request(
      unsafeRequest({
        'X-Digarr-CSRF': '1',
        Origin: APP_ORIGIN,
        'Sec-Fetch-Site': 'same-origin',
      }),
    )

    expect(res.status).toBe(200)
  })

  it('rejects public cross-site browser requests', async () => {
    const res = await createGuardApp().request(
      unsafeRequest({
        'X-Digarr-CSRF': '1',
        Origin: 'https://evil.example',
        'Sec-Fetch-Site': 'cross-site',
      }),
    )

    expect(res.status).toBe(403)
  })

  it('preserves public non-browser compatibility when browser signals are absent', async () => {
    const res = await createGuardApp().request(unsafeRequest())

    expect(res.status).toBe(200)
  })

  it.each(['not a URL', 'null'])(
    'rejects an explicit %s Origin even when an exact Referer is supplied',
    async (origin) => {
      const res = await createGuardApp('session-cookie').request(
        unsafeRequest({
          'X-Digarr-CSRF': '1',
          Origin: origin,
          Referer: `${APP_ORIGIN}/settings`,
        }),
      )

      expect(res.status).toBe(403)
    },
  )

  it('accepts an exact Origin without fetch metadata', async () => {
    const res = await createGuardApp('session-cookie').request(
      unsafeRequest({ 'X-Digarr-CSRF': '1', Origin: APP_ORIGIN }),
    )

    expect(res.status).toBe(200)
  })

  it('falls back to an exact Referer origin when Origin and fetch metadata are absent', async () => {
    const res = await createGuardApp('session-cookie').request(
      unsafeRequest({ 'X-Digarr-CSRF': '1', Referer: `${APP_ORIGIN}/settings/profile` }),
    )

    expect(res.status).toBe(200)
  })

  it('rejects a conflicting Origin despite same-origin fetch metadata', async () => {
    const res = await createGuardApp('session-cookie').request(
      unsafeRequest({
        'X-Digarr-CSRF': '1',
        Origin: 'https://evil.example',
        'Sec-Fetch-Site': 'same-origin',
      }),
    )

    expect(res.status).toBe(403)
  })

  it('fails closed for ambient auth when the configured URL has an opaque origin', async () => {
    vi.resetModules()
    vi.doMock('@/config/env', async (importOriginal) => {
      const original = await importOriginal<typeof import('@/config/env')>()
      return {
        ...original,
        envConfig: { ...original.envConfig, allowedOrigin: 'file:///tmp/app' },
      }
    })

    try {
      const { csrfGuard: opaqueOriginGuard } = await import('@/server/middleware/csrf')
      for (const authMethod of ['session-cookie', 'proxy'] as const) {
        for (const fetchSite of [undefined, 'same-origin', 'same-site', 'cross-site', 'none']) {
          const app = new Hono<HonoEnv>()
          app.use('*', async (c, next) => {
            c.set('authMethod', authMethod)
            await next()
          })
          app.use('*', opaqueOriginGuard)
          app.post('/api/v1/test', (c) => c.json({ ok: true }))

          const headers: Record<string, string> = {
            'X-Digarr-CSRF': '1',
            Origin: 'null',
          }
          if (fetchSite) headers['Sec-Fetch-Site'] = fetchSite

          const res = await app.request(unsafeRequest(headers))
          expect(res.status).toBe(403)
        }
      }
    } finally {
      vi.doUnmock('@/config/env')
      vi.resetModules()
    }
  })

  it.each<AuthMethod>(['session-query', 'legacy-query'])(
    'rejects unsafe %s auth even with valid browser evidence',
    async (authMethod) => {
      const res = await createGuardApp(authMethod).request(
        unsafeRequest({
          'X-Digarr-CSRF': '1',
          Origin: APP_ORIGIN,
          'Sec-Fetch-Site': 'same-origin',
        }),
      )

      expect(res.status).toBe(403)
    },
  )

  it('returns the canonical non-oracular RFC 9457 problem', async () => {
    const res = await createGuardApp('session-cookie').request(unsafeRequest())

    expect(res.status).toBe(403)
    expect(res.headers.get('content-type')).toContain('application/problem+json')
    await expect(res.json()).resolves.toEqual({
      type: '/problems/csrf-validation-failed',
      title: 'Request rejected',
      status: 403,
    })
  })
})

describe('csrf middleware integration', () => {
  beforeEach(async () => {
    await clearAllSessions()
  })

  afterEach(async () => {
    await clearAllSessions()
  })

  it('requires same-origin CSRF proof for a cookie-authenticated locale mutation', async () => {
    const updateUserPreferredLocale = vi.fn(async () => {})
    const app = createApp(makeDeps({ updateUserPreferredLocale }))
    await createSession(1, 'cookie-session-token')
    const request = {
      method: 'PATCH',
      headers: {
        Cookie: `${SESSION_COOKIE_NAME}=cookie-session-token`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ preferredLocale: 'de' }),
    }

    const missingProof = await app.request('/api/v1/auth/me/locale', request)
    expect(missingProof.status).toBe(403)
    expect(updateUserPreferredLocale).not.toHaveBeenCalled()

    const valid = await app.request('/api/v1/auth/me/locale', {
      ...request,
      headers: {
        ...request.headers,
        'X-Digarr-CSRF': '1',
        Origin: APP_ORIGIN,
        'Sec-Fetch-Site': 'same-origin',
      },
    })
    expect(valid.status).toBe(200)
    expect(updateUserPreferredLocale).toHaveBeenCalledWith(1, 'de')
  })

  it('allows a bearer-authenticated locale mutation without CSRF headers', async () => {
    const updateUserPreferredLocale = vi.fn(async () => {})
    const app = createApp(makeDeps({ updateUserPreferredLocale }))
    await createSession(1, 'bearer-session-token')

    const res = await app.request('/api/v1/auth/me/locale', {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer bearer-session-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ preferredLocale: 'de' }),
    })

    expect(res.status).toBe(200)
    expect(updateUserPreferredLocale).toHaveBeenCalledWith(1, 'de')
  })

  it('rejects cross-site login before credential processing', async () => {
    const getUserByUsername = vi.fn(async () => null)
    const app = createApp(makeDeps({ getUserByUsername }))

    const res = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Digarr-CSRF': '1',
        Origin: 'https://evil.example',
        'Sec-Fetch-Site': 'cross-site',
      },
      body: JSON.stringify({ username: 'admin', password: 'password1234' }),
    })

    expect(res.status).toBe(403)
    expect(getUserByUsername).not.toHaveBeenCalled()
  })

  it('advertises both custom auth headers in configured-origin CORS preflight', async () => {
    const app = createApp(makeDeps())

    const res = await app.request('/api/v1/auth/me/locale', {
      method: 'OPTIONS',
      headers: {
        Origin: APP_ORIGIN,
        'Access-Control-Request-Method': 'PATCH',
        'Access-Control-Request-Headers':
          'Authorization, Content-Type, X-Digarr-Locale, X-Digarr-CSRF, X-Digarr-Auth-Mode',
      },
    })

    expect(res.status).toBe(204)
    const allowHeaders = res.headers.get('Access-Control-Allow-Headers')?.toLowerCase() ?? ''
    expect(allowHeaders).toContain('x-digarr-csrf')
    expect(allowHeaders).toContain('x-digarr-auth-mode')
  })
})
