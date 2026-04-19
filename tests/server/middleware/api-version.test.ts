// @vitest-environment node
import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { apiVersionRedirect } from '@/server/middleware/api-version'

describe('apiVersionRedirect', () => {
  function makeApp() {
    const app = new Hono()
    app.use('*', apiVersionRedirect)
    app.get('/api/v1/ping', (c) => c.text('pong'))
    app.get('/healthz', (c) => c.text('alive'))
    return app
  }

  it('redirects unversioned /api/* to /api/v1/* with 308', async () => {
    const app = makeApp()
    const res = await app.request('/api/ping?foo=bar', {
      method: 'GET',
      redirect: 'manual',
    })
    expect(res.status).toBe(308)
    expect(res.headers.get('location')).toBe('/api/v1/ping?foo=bar')
  })

  it('preserves POST method on redirect (308 semantics)', async () => {
    const app = makeApp()
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      redirect: 'manual',
    })
    expect(res.status).toBe(308)
    expect(res.headers.get('location')).toBe('/api/v1/auth/login')
  })

  it('lets /api/v1/* pass through', async () => {
    const app = makeApp()
    const res = await app.request('/api/v1/ping', { method: 'GET' })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('pong')
  })

  it('does not touch non-/api paths', async () => {
    const app = makeApp()
    const res = await app.request('/healthz', { method: 'GET' })
    expect(res.status).toBe(200)
  })

  it('emits Deprecation and Sunset headers on the redirect', async () => {
    const app = makeApp()
    const res = await app.request('/api/ping', { method: 'GET', redirect: 'manual' })
    expect(res.headers.get('deprecation')).toBe('true')
    expect(res.headers.get('sunset')).toMatch(/GMT$/)
  })
})
