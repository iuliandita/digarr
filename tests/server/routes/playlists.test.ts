// @vitest-environment node

import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlaylistDeps } from '@/server/routes/playlists'
import { playlistRoutes } from '@/server/routes/playlists'

const USER_ID = 42

const mockPlaylist = {
  id: 1,
  userId: USER_ID,
  name: 'Weekly Mix',
  strategy: 'weekly_digest',
  targetIds: [],
  schedule: null,
  config: { size: 25, trackSourcePriority: ['spotify'] },
  lastGeneratedAt: null,
  trackCount: 0,
  enabled: true,
  createdAt: new Date('2024-01-01'),
}

const mockTrack = {
  id: 1,
  playlistId: 1,
  artistName: 'Radiohead',
  trackName: 'Creep',
  mbid: null,
  spotifyUri: 'spotify:track:abc',
  deezerId: null,
  localPath: null,
  position: 0,
}

const mockPlaylistScheduler = {
  schedule: vi.fn(),
  remove: vi.fn(),
  has: vi.fn(() => false),
  listJobs: vi.fn(() => [] as Array<{ name: string; expression: string; nextRun: Date | null }>),
  stopAll: vi.fn(),
  nextRun: vi.fn(() => null as Date | null),
}

const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}

function makeDeps(overrides: Partial<PlaylistDeps> = {}): PlaylistDeps {
  return {
    db: mockDb as unknown as PlaylistDeps['db'],
    playlistScheduler: mockPlaylistScheduler as unknown as PlaylistDeps['playlistScheduler'],
    runPlaylistGeneration: vi.fn().mockResolvedValue(undefined),
    restartPlaylistScheduler: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function createTestApp(deps: PlaylistDeps, userId: number | undefined) {
  const app = new Hono()
  app.use('*', async (c, next) => {
    if (userId !== undefined) {
      c.set('userId' as never, userId as never)
    }
    return next()
  })
  app.route('/', playlistRoutes(deps))
  return app
}

// Mock playlist queries used by the route - factory must not reference module-level vars (hoisting)
vi.mock('@/db/queries/playlists', () => ({
  createPlaylist: vi.fn(),
  getPlaylistsByUser: vi.fn(),
  getPlaylistWithTracks: vi.fn(),
  updatePlaylist: vi.fn(),
  deletePlaylist: vi.fn(),
  replacePlaylistTracks: vi.fn(),
  getPlaylistsDueForGeneration: vi.fn(),
}))

// Mock generator to avoid running real generation in tests
vi.mock('@/core/playlists/generator', () => ({
  generatePlaylist: vi.fn(),
  getStrategy: vi.fn(),
}))

// Mock settings queries for scheduler endpoint
vi.mock('@/db/queries/settings', () => ({
  getSettings: vi.fn().mockResolvedValue({
    preferences: { playlistSchedule: '0 6 * * 1', playlistEnabled: true },
  }),
}))

beforeEach(async () => {
  vi.clearAllMocks()
  mockPlaylistScheduler.nextRun.mockReturnValue(null)
  mockPlaylistScheduler.listJobs.mockReturnValue([])

  const {
    createPlaylist,
    getPlaylistsByUser,
    getPlaylistWithTracks,
    updatePlaylist,
    deletePlaylist,
    replacePlaylistTracks,
  } = vi.mocked(await import('@/db/queries/playlists'))

  const { generatePlaylist } = vi.mocked(await import('@/core/playlists/generator'))

  createPlaylist.mockResolvedValue({ id: 1 })
  getPlaylistsByUser.mockResolvedValue([mockPlaylist] as never)
  getPlaylistWithTracks.mockImplementation(async (_db, id) =>
    id === 1 ? ({ playlist: mockPlaylist, tracks: [mockTrack] } as never) : null,
  )
  updatePlaylist.mockResolvedValue(undefined)
  deletePlaylist.mockResolvedValue(undefined)
  replacePlaylistTracks.mockResolvedValue(undefined)
  generatePlaylist.mockResolvedValue({
    tracks: [],
    artistCount: 0,
    strategy: 'weekly_digest',
  } as never)
})

describe('GET /api/playlists/scheduler', () => {
  it('returns null nextRun when scheduler is idle', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/playlists/scheduler')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { nextRun: string | null }
    expect(body.nextRun).toBeNull()
  })

  it('returns ISO string when scheduler is running', async () => {
    const nextDate = new Date('2025-01-06T06:00:00Z')
    const app = createTestApp(
      makeDeps({
        playlistScheduler: {
          ...mockPlaylistScheduler,
          listJobs: () => [
            {
              name: 'playlist-1',
              expression: '0 6 * * 1',
              nextRun: nextDate,
            },
          ],
        } as unknown as PlaylistDeps['playlistScheduler'],
      }),
      USER_ID,
    )
    const res = await app.request('/api/playlists/scheduler')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { nextRun: string | null }
    expect(body.nextRun).toBe(nextDate.toISOString())
  })

  it('returns 401 when not authenticated', async () => {
    const app = createTestApp(makeDeps(), undefined)
    const res = await app.request('/api/playlists/scheduler')
    expect(res.status).toBe(401)
  })
})

describe('GET /api/playlists', () => {
  it('returns playlists for the authenticated user', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/playlists')
    expect(res.status).toBe(200)
    const body = (await res.json()) as unknown[]
    expect(Array.isArray(body)).toBe(true)
  })

  it('returns 401 when unauthenticated', async () => {
    const app = createTestApp(makeDeps(), undefined)
    const res = await app.request('/api/playlists')
    expect(res.status).toBe(401)
  })
})

describe('POST /api/playlists', () => {
  it('creates a playlist with valid body', async () => {
    const deps = makeDeps()
    const app = createTestApp(deps, USER_ID)
    const res = await app.request('/api/playlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'My Mix', strategy: 'weekly_digest' }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: number }
    expect(typeof body.id).toBe('number')
    expect(deps.restartPlaylistScheduler).toHaveBeenCalledOnce()
  })

  it('returns 400 when name is missing', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/playlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strategy: 'weekly_digest' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid strategy', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/playlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'My Mix', strategy: 'not_a_strategy' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid schedule cron', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/playlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'My Mix', strategy: 'weekly_digest', schedule: 'not a cron' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 401 when unauthenticated', async () => {
    const app = createTestApp(makeDeps(), undefined)
    const res = await app.request('/api/playlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'X', strategy: 'weekly_digest' }),
    })
    expect(res.status).toBe(401)
  })
})

describe('GET /api/playlists/:id', () => {
  it('returns playlist with tracks for owner', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/playlists/1')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { playlist: unknown; tracks: unknown[] }
    expect(body.playlist).toBeDefined()
    expect(Array.isArray(body.tracks)).toBe(true)
  })

  it('hides cross-user playlist with 404', async () => {
    const app = createTestApp(makeDeps(), 999) // different user
    const res = await app.request('/api/playlists/1')
    expect(res.status).toBe(404)
  })

  it('returns 404 for missing playlist', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/playlists/9999')
    expect(res.status).toBe(404)
  })
})

describe('GET /api/playlists/:id/export/:format', () => {
  it('exports a playlist as M3U for the owner', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/playlists/1/export/m3u')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('audio/x-mpegurl')
    expect(res.headers.get('content-disposition')).toContain('weekly-mix.m3u')
    const body = await res.text()
    expect(body).toContain('#EXTM3U')
    expect(body).toContain('Radiohead - Creep')
  })

  it('exports a playlist as XSPF for the owner', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/playlists/1/export/xspf')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/xspf+xml')
    const body = await res.text()
    expect(body).toContain('<?xml')
    expect(body).toContain('<title>Weekly Mix</title>')
  })

  it('returns 400 for unsupported export format', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/playlists/1/export/xml')
    expect(res.status).toBe(400)
  })

  it('hides cross-user playlist with 404 export access', async () => {
    const app = createTestApp(makeDeps(), 999)
    const res = await app.request('/api/playlists/1/export/m3u')
    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/playlists/:id', () => {
  it('updates allowed fields for owner', async () => {
    const deps = makeDeps()
    const app = createTestApp(deps, USER_ID)
    const res = await app.request('/api/playlists/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated Mix', enabled: false }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { updated: boolean }
    expect(body.updated).toBe(true)
    expect(deps.restartPlaylistScheduler).toHaveBeenCalledOnce()
  })

  it('hides cross-user playlist with 404', async () => {
    const app = createTestApp(makeDeps(), 999)
    const res = await app.request('/api/playlists/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'hack' }),
    })
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/playlists/:id', () => {
  it('deletes playlist for owner', async () => {
    const deps = makeDeps()
    const app = createTestApp(deps, USER_ID)
    const res = await app.request('/api/playlists/1', { method: 'DELETE' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { deleted: boolean }
    expect(body.deleted).toBe(true)
    expect(deps.restartPlaylistScheduler).toHaveBeenCalledOnce()
  })

  it('hides cross-user playlist with 404', async () => {
    const app = createTestApp(makeDeps(), 999)
    const res = await app.request('/api/playlists/1', { method: 'DELETE' })
    expect(res.status).toBe(404)
  })
})

describe('POST /api/playlists/:id/generate', () => {
  it('returns 202 and fires generation for owner', async () => {
    const deps = makeDeps()
    const app = createTestApp(deps, USER_ID)
    const res = await app.request('/api/playlists/1/generate', { method: 'POST' })
    expect(res.status).toBe(202)
    const body = (await res.json()) as { status: string }
    expect(body.status).toBe('generating')
    expect(deps.runPlaylistGeneration).toHaveBeenCalledWith(1)
  })

  it('hides cross-user playlist with 404', async () => {
    const app = createTestApp(makeDeps(), 999)
    const res = await app.request('/api/playlists/1/generate', { method: 'POST' })
    expect(res.status).toBe(404)
  })

  it('returns 404 for missing playlist', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/playlists/9999/generate', { method: 'POST' })
    expect(res.status).toBe(404)
  })
})
