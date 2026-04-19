// @vitest-environment node

import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '@/server/types'

vi.mock('@/core/clients/lidarr', () => ({
  createLidarrClient: vi.fn(() => ({
    addArtist: vi.fn(async () => ({ id: 42, artistName: 'Test' })),
    getArtists: vi.fn(async () => []),
    getMetadataProfiles: vi.fn(async () => []),
    getQualityProfiles: vi.fn(async () => []),
    getRootFolders: vi.fn(async () => []),
  })),
}))

const { lidarrRoutes } = await import('@/server/routes/lidarr')

type RouteDeps = Parameters<typeof lidarrRoutes>[0]

function makeDeps(overrides: Partial<RouteDeps> = {}): RouteDeps {
  const defaults = {
    getSettings: vi.fn(async () => ({
      lidarrUrl: 'http://lidarr.local',
      lidarrApiKey: 'abc',
      skipTlsVerify: false,
    })),
    getUserById: vi.fn(async (id: number) => ({
      id,
      isAdmin: id === 1,
      username: id === 1 ? 'admin' : 'user',
    })),
  } as unknown as RouteDeps
  return Object.assign(defaults, overrides)
}

function createTestApp(opts: { userId?: number; deps?: Partial<RouteDeps> } = {}) {
  const app = new Hono<HonoEnv>()
  app.use('*', async (c, next) => {
    if (opts.userId !== undefined) c.set('userId', opts.userId)
    await next()
  })
  app.route('/', lidarrRoutes(makeDeps(opts.deps)))
  return app
}

describe('POST /api/v1/lidarr/add', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 403 for non-admin user', async () => {
    const app = createTestApp({ userId: 2 })
    const res = await app.request('/api/v1/lidarr/add', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ foreignArtistId: 'mbid-1', artistName: 'Test' }),
    })
    expect(res.status).toBe(403)
  })

  it('returns 403 for unauthenticated caller', async () => {
    const app = createTestApp({})
    const res = await app.request('/api/v1/lidarr/add', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ foreignArtistId: 'mbid-1', artistName: 'Test' }),
    })
    expect(res.status).toBe(403)
  })

  it('returns 400 on malformed body', async () => {
    const app = createTestApp({ userId: 1 })
    const res = await app.request('/api/v1/lidarr/add', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 when artistName missing', async () => {
    const app = createTestApp({ userId: 1 })
    const res = await app.request('/api/v1/lidarr/add', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ foreignArtistId: 'mbid-1' }),
    })
    expect(res.status).toBe(400)
  })

  it('accepts admin request with valid body', async () => {
    const app = createTestApp({ userId: 1 })
    const res = await app.request('/api/v1/lidarr/add', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ foreignArtistId: 'mbid-1', artistName: 'Test Artist' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: number }
    expect(body.id).toBe(42)
  })
})
