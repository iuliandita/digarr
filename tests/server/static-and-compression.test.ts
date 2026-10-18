// @vitest-environment node

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createSession } from '@/core/sessions'
import { setupGuard } from '@/server/middleware/setup-guard'
import { mountStatic } from '@/server/static'
import { createTestApp } from '../helpers/test-app'

describe('static caching headers', () => {
  let root: string
  let app: Hono

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'digarr-web-'))
    mkdirSync(join(root, 'assets'))
    writeFileSync(join(root, 'assets', 'app-abc123.js'), 'console.log(1)')
    writeFileSync(join(root, 'index.html'), '<!doctype html><html></html>')
    writeFileSync(join(root, 'sw.js'), 'self.skipWaiting()')
    app = new Hono()
    mountStatic(app, root)
  })

  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('pins hashed assets as immutable', async () => {
    const res = await app.request('/assets/app-abc123.js')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
  })

  it.each(['/index.html', '/', '/some/spa/route', '/sw.js'])('revalidates %s', async (path) => {
    const res = await app.request(path)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-cache')
  })

  it('does not pin the SPA fallback served for a missing asset', async () => {
    const res = await app.request('/assets/missing-deadbeef.js')
    expect(res.headers.get('cache-control')).toBe('no-cache')
  })
})

describe('JSON compression', () => {
  it('gzips large JSON when asked', async () => {
    const { app } = createTestApp()
    const res = await app.request('/api/v1/docs/openapi.json', {
      headers: { 'Accept-Encoding': 'gzip' },
    })
    expect(res.headers.get('content-encoding')).toBe('gzip')
    expect(res.headers.get('vary')).toContain('Accept-Encoding')
  })

  it('leaves JSON alone without Accept-Encoding', async () => {
    const { app } = createTestApp()
    const res = await app.request('/api/v1/docs/openapi.json')
    expect(res.headers.get('content-encoding')).toBeNull()
  })

  it('never compresses the SSE stream', async () => {
    const { app } = createTestApp()
    await createSession(1, 'compress-sse-token')
    const res = await app.request('/api/v1/pipeline/events', {
      headers: { Authorization: 'Bearer compress-sse-token', 'Accept-Encoding': 'gzip' },
    })
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    expect(res.headers.get('content-encoding')).toBeNull()
    await res.body?.cancel()
  })
})

describe('setup guard caching', () => {
  it('keeps checking until setup completes, then stops asking', async () => {
    const isComplete = vi.fn<() => Promise<boolean>>()
    const app = new Hono()
    app.use('*', setupGuard(isComplete))
    app.get('/api/v1/thing', (c) => c.text('ok'))

    isComplete.mockResolvedValue(false)
    expect((await app.request('/api/v1/thing')).status).toBe(403)
    expect((await app.request('/api/v1/thing')).status).toBe(403)
    expect(isComplete).toHaveBeenCalledTimes(2)

    isComplete.mockResolvedValue(true)
    expect((await app.request('/api/v1/thing')).status).toBe(200)
    expect((await app.request('/api/v1/thing')).status).toBe(200)
    expect(isComplete).toHaveBeenCalledTimes(3)
  })
})
