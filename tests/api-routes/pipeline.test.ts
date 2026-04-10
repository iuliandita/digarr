// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createTestApp } from '../helpers/test-app'

vi.mock('@/core/sessions', () => ({
  getSession: vi.fn().mockResolvedValue({
    userId: 1,
    token: 'tok',
    expiresAt: new Date(Date.now() + 86400000),
  }),
}))

// Pipeline /run calls getUserConnections which uses Drizzle's select chain.
// Mock it at the module level to avoid needing a real DB.
vi.mock('@/db/queries/users', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/db/queries/users')>()
  return {
    ...original,
    getUserConnections: vi.fn(async () => null),
  }
})

// Pipeline /run calls resolveSpotifyToken which queries DB for OAuth tokens.
vi.mock('@/core/spotify-auth', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/core/spotify-auth')>()
  return {
    ...original,
    resolveSpotifyToken: vi.fn(async () => null),
  }
})

// resolveUserPreferences calls DB queries -- mock the whole helper.
vi.mock('@/server/helpers/preferences', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/server/helpers/preferences')>()
  return {
    ...original,
    resolveUserPreferences: vi.fn(async (_db: unknown, prefs: unknown) => prefs),
  }
})

describe('API routes: pipeline', () => {
  it('triggers scan and returns 202', async () => {
    const { app } = createTestApp()

    const runRes = await app.request('/api/pipeline/run', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok' },
    })
    expect(runRes.status).toBe(202)
    const body = await runRes.json()
    expect(body.message).toBeDefined()
  })

  it('returns 409 when pipeline is already running', async () => {
    const { app, deps } = createTestApp()
    // Simulate running state
    ;(deps.orchestrator as unknown as Record<string, unknown>).isRunning = true

    const runRes = await app.request('/api/pipeline/run', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok' },
    })
    expect(runRes.status).toBe(409)
  })

  it('returns pipeline status', async () => {
    const { app } = createTestApp()

    const statusRes = await app.request('/api/pipeline/status', {
      headers: { Authorization: 'Bearer tok' },
    })
    expect(statusRes.status).toBe(200)
    const body = await statusRes.json()
    expect(typeof body.running).toBe('boolean')
  })

  it('job health endpoint works for admin users', async () => {
    const { app } = createTestApp()

    const healthRes = await app.request('/api/jobs/health', {
      headers: { Authorization: 'Bearer tok' },
    })
    expect(healthRes.status).toBe(200)
    const health = await healthRes.json()
    expect(health.pipeline).toBeDefined()
  })
})
