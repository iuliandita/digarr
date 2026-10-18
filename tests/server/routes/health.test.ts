import { afterEach, describe, expect, it, vi } from 'vitest'
import { markShuttingDown, resetLifecycleForTests } from '@/core/lifecycle'
import type { AppDependencies } from '@/server'
import { createApp } from '@/server'
import { makeDeps as makeSharedDeps } from '../../helpers/test-app'

function makeDeps(overrides: Partial<AppDependencies> = {}): AppDependencies {
  return makeSharedDeps({
    scheduler: {} as AppDependencies['scheduler'],
    providerRegistry: {} as unknown as AppDependencies['providerRegistry'],
    getSettings: vi.fn(async () => null),
    getUserById: vi.fn(async () => null),
    getUserCount: vi.fn(async () => 0),
    ...overrides,
  })
}

describe('GET /health', () => {
  afterEach(() => {
    resetLifecycleForTests()
  })

  it('returns 200 with status ok', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
  })

  it('includes version, gitSha and channel in the ok body', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/)
    expect(body.gitSha).toBe('dev')
    expect(body.channel).toBe('local')
  })

  it('reports the active db backend', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(['pglite', 'postgres']).toContain(body.dbBackend)
  })

  it('returns 503 with status draining when shutting down', async () => {
    const app = createApp(makeDeps())
    markShuttingDown()
    const res = await app.request('/health')
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.status).toBe('draining')
  })

  it('short-circuits DB check when shutting down', async () => {
    const execute = vi.fn(async () => [])
    const deps = makeDeps({
      db: { execute } as unknown as AppDependencies['db'],
    })
    const app = createApp(deps)
    markShuttingDown()
    await app.request('/health')
    expect(execute).not.toHaveBeenCalled()
  })
})

describe('setup guard', () => {
  it('blocks /api/* with 403 when setup is not complete', async () => {
    const app = createApp(makeDeps({ isSetupComplete: async () => false }))
    const res = await app.request('/api/v1/something')
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('Setup not complete')
    expect(body.redirect).toBe('/setup')
  })

  it('allows /api/setup/* through when setup is not complete', async () => {
    const app = createApp(makeDeps({ isSetupComplete: async () => false }))
    const res = await app.request('/api/v1/setup/status')
    expect(res.status).not.toBe(403)
  })

  it('allows /health through when setup is not complete', async () => {
    const app = createApp(makeDeps({ isSetupComplete: async () => false }))
    const res = await app.request('/health')
    expect(res.status).toBe(200)
  })

  it('allows /api/* through when setup is complete', async () => {
    const app = createApp(makeDeps())
    // No route registered for this path - expect 404, not 403
    const res = await app.request('/api/v1/something')
    expect(res.status).not.toBe(403)
  })
})
