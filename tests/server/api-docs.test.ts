// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { createTestApp } from '../helpers/test-app'

function directive(policy: string, name: string): string | undefined {
  return policy
    .split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name} `))
}

describe('API reference viewer', () => {
  it('is public like the spec, while other API routes still need credentials', async () => {
    const { app } = createTestApp()

    expect((await app.request('/api/v1/settings')).status).toBe(401)
    for (const path of [
      '/api/v1/docs',
      '/api/v1/docs/redoc.standalone.js',
      '/api/v1/docs/openapi.json',
    ]) {
      expect((await app.request(path)).status, path).toBe(200)
    }
  })

  it('serves a page with a same-origin script, a same-origin spec and no inline script', async () => {
    const { app } = createTestApp()

    const res = await app.request('/api/v1/docs')
    const html = await res.text()

    expect(res.headers.get('content-type')).toContain('text/html')
    expect(html).toContain('spec-url="/api/v1/docs/openapi.json"')
    expect(html).toContain('src="/api/v1/docs/redoc.standalone.js"')
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)/)
    expect(html).not.toMatch(/https?:\/\//)
  })

  it('allows blob workers and nothing remote on the viewer page only', async () => {
    const { app } = createTestApp()

    const docs = (await app.request('/api/v1/docs')).headers.get('content-security-policy') ?? ''
    const other = (await app.request('/api/v1/auth/status')).headers.get('content-security-policy')

    expect(directive(docs, 'worker-src')).toBe("worker-src 'self' blob:")
    expect(directive(docs, 'script-src')).toBe("script-src 'self'")
    expect(directive(docs, 'connect-src')).toBe("connect-src 'self'")
    expect(directive(docs, 'img-src')).toBe("img-src 'self' data:")
    expect(docs).not.toContain('https:')
    expect(other).not.toContain('blob:')
  })

  it('serves the bundled script from this origin without the remote logo', async () => {
    const { app } = createTestApp()

    const res = await app.request('/api/v1/docs/redoc.standalone.js', {
      headers: { 'accept-encoding': 'gzip' },
    })

    expect(res.headers.get('content-type')).toContain('text/javascript')
    expect(res.headers.get('content-encoding')).toBe('gzip')
    const body = await new Response(res.body?.pipeThrough(new DecompressionStream('gzip'))).text()
    expect(body.length).toBeGreaterThan(100_000)
    expect(body).not.toContain('cdn.redoc.ly')
  })
})
