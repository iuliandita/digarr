// @vitest-environment node

import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '@/server/types'

vi.mock('@/core/clients/lidarr', () => ({
  createLidarrClient: vi.fn(() => ({
    addArtist: vi.fn(async () => ({ id: 42, artistName: 'Test' })),
    getArtists: vi.fn(async () => []),
    // Carry extra fields the approve-options projection must strip: profiles
    // gain a stray prop, root folders carry freeSpace + structure metadata.
    getMetadataProfiles: vi.fn(async () => [{ id: 10, name: 'Standard', extra: 'leak' }]),
    getQualityProfiles: vi.fn(async () => [{ id: 20, name: 'FLAC', extra: 'leak' }]),
    getRootFolders: vi.fn(async () => [
      { id: 30, path: '/music', freeSpace: 9_999_999, unmappedFolders: ['/secret'] },
    ]),
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

describe('GET /api/v1/lidarr/* (admin guard)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 403 for non-admin user on /rootfolders', async () => {
    const app = createTestApp({ userId: 2 })
    const res = await app.request('/api/v1/lidarr/rootfolders')
    expect(res.status).toBe(403)
  })

  it('returns 403 for unauthenticated caller on /rootfolders', async () => {
    const app = createTestApp({})
    const res = await app.request('/api/v1/lidarr/rootfolders')
    expect(res.status).toBe(403)
  })

  it('returns 200 for admin user on /rootfolders', async () => {
    const app = createTestApp({ userId: 1 })
    const res = await app.request('/api/v1/lidarr/rootfolders')
    expect(res.status).toBe(200)
  })

  it('returns 403 for non-admin user on /stats', async () => {
    const app = createTestApp({ userId: 2 })
    const res = await app.request('/api/v1/lidarr/stats')
    expect(res.status).toBe(403)
  })

  it('returns 403 for non-admin user on /profiles', async () => {
    const app = createTestApp({ userId: 2 })
    const res = await app.request('/api/v1/lidarr/profiles')
    expect(res.status).toBe(403)
  })

  it('returns 403 for non-admin user on /metadataprofiles', async () => {
    const app = createTestApp({ userId: 2 })
    const res = await app.request('/api/v1/lidarr/metadataprofiles')
    expect(res.status).toBe(403)
  })
})

describe('GET /api/v1/lidarr/approve-options (non-admin picker)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 200 with picker data for a non-admin user', async () => {
    const app = createTestApp({ userId: 2 })
    const res = await app.request('/api/v1/lidarr/approve-options')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      qualityProfiles: Array<{ id: number; name: string }>
      metadataProfiles: Array<{ id: number; name: string }>
      rootFolders: Array<{ id: number; path: string }>
    }
    expect(body.qualityProfiles).toEqual([{ id: 20, name: 'FLAC' }])
    expect(body.metadataProfiles).toEqual([{ id: 10, name: 'Standard' }])
    expect(body.rootFolders).toEqual([{ id: 30, path: '/music' }])
  })

  it('projects away freeSpace and any structure metadata', async () => {
    const app = createTestApp({ userId: 2 })
    const res = await app.request('/api/v1/lidarr/approve-options')
    const raw = await res.text()
    // Regression guard for the .map projection: none of the stripped fields
    // may leak into the serialized response.
    expect(raw).not.toContain('freeSpace')
    expect(raw).not.toContain('unmappedFolders')
    expect(raw).not.toContain('extra')
  })

  // Unlike the four GETs above, this route omits adminGuard on purpose so a
  // non-admin can populate the approve dialog. Login is still enforced, but by
  // the app-level auth middleware (see src/server/index.ts), not here -- so
  // there is no per-route auth assertion to make in this unit harness.
  it('does not wrap the route in adminGuard (admin also gets 200)', async () => {
    const app = createTestApp({ userId: 1 })
    const res = await app.request('/api/v1/lidarr/approve-options')
    expect(res.status).toBe(200)
  })
})

describe('Lidarr onError sanitization', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does not leak internal error details in the response', async () => {
    const { createLidarrClient } = await import('@/core/clients/lidarr')
    vi.mocked(createLidarrClient).mockReturnValueOnce({
      getArtists: vi.fn(async () => {
        throw new Error('connect ECONNREFUSED 10.0.0.5:8686')
      }),
    } as never)

    const app = createTestApp({ userId: 1 })
    const res = await app.request('/api/v1/lidarr/stats')
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('An unexpected error occurred')
    expect(JSON.stringify(body)).not.toContain('10.0.0.5')
    expect(JSON.stringify(body)).not.toContain('8686')
  })
})
