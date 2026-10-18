// @vitest-environment node

import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { withPlaylistLock } from '@/core/playlists/generation-lock'
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
}))

vi.mock('@/db/queries/jobs', () => ({ getLatestPlaylistGeneration: vi.fn() }))
vi.mock('@/db/queries/playlist-exports', () => ({
  getPlaylistExports: vi.fn().mockResolvedValue([]),
  getPlaylistExport: vi.fn().mockResolvedValue(null),
  resetPlaylistExport: vi.fn().mockResolvedValue(undefined),
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
  mockDb.select.mockReturnValue({
    from: vi.fn().mockReturnValue({
      leftJoin: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    }),
  })
  const exports = vi.mocked(await import('@/db/queries/playlist-exports'))
  exports.getPlaylistExports.mockResolvedValue([])
  exports.getPlaylistExport.mockResolvedValue(null)
  const { getLatestPlaylistGeneration } = vi.mocked(await import('@/db/queries/jobs'))
  getLatestPlaylistGeneration.mockResolvedValue(null)
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

describe('GET /api/v1/playlists/scheduler', () => {
  it('returns null nextRun when scheduler is idle', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/v1/playlists/scheduler')
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
    const res = await app.request('/api/v1/playlists/scheduler')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { nextRun: string | null }
    expect(body.nextRun).toBe(nextDate.toISOString())
  })

  it('returns 401 when not authenticated', async () => {
    const app = createTestApp(makeDeps(), undefined)
    const res = await app.request('/api/v1/playlists/scheduler')
    expect(res.status).toBe(401)
  })
})

describe('GET /api/v1/playlists', () => {
  it('returns playlists for the authenticated user', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/v1/playlists')
    expect(res.status).toBe(200)
    const body = (await res.json()) as unknown[]
    expect(Array.isArray(body)).toBe(true)
  })

  it('returns 401 when unauthenticated', async () => {
    const app = createTestApp(makeDeps(), undefined)
    const res = await app.request('/api/v1/playlists')
    expect(res.status).toBe(401)
  })
})

describe('POST /api/v1/playlists', () => {
  it('creates a playlist with valid body', async () => {
    const deps = makeDeps()
    const app = createTestApp(deps, USER_ID)
    const res = await app.request('/api/v1/playlists', {
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
    const res = await app.request('/api/v1/playlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strategy: 'weekly_digest' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid strategy', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/v1/playlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'My Mix', strategy: 'not_a_strategy' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid schedule cron', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/v1/playlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'My Mix', strategy: 'weekly_digest', schedule: 'not a cron' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 401 when unauthenticated', async () => {
    const app = createTestApp(makeDeps(), undefined)
    const res = await app.request('/api/v1/playlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'X', strategy: 'weekly_digest' }),
    })
    expect(res.status).toBe(401)
  })
})

describe('playlist configuration writes', () => {
  const methods = ['POST', 'PATCH'] as const
  const requestBody = (method: (typeof methods)[number], config: unknown) => ({
    ...(method === 'POST' ? { name: 'My Mix', strategy: 'weekly_digest' } : {}),
    config,
  })
  const requestPath = (method: (typeof methods)[number]) =>
    method === 'POST' ? '/api/v1/playlists' : '/api/v1/playlists/1'

  it.each(
    methods.flatMap((method) => [
      { method, config: {}, expected: { size: 25, trackSourcePriority: ['spotify'] } },
      { method, config: { size: 5 }, expected: { size: 5, trackSourcePriority: ['spotify'] } },
      {
        method,
        config: { genre: 'rock' },
        expected: { size: 25, genre: 'rock', trackSourcePriority: ['spotify'] },
      },
      {
        method,
        config: { mood: '' },
        expected: { size: 25, mood: '', trackSourcePriority: ['spotify'] },
      },
      {
        method,
        config: { trackSourcePriority: [] },
        expected: { size: 25, trackSourcePriority: [] },
      },
      {
        method,
        config: { trackSourcePriority: ['local', 'deezer', 'spotify'] },
        expected: { size: 25, trackSourcePriority: ['local', 'deezer', 'spotify'] },
      },
    ]),
  )('$method saves canonical config for $config', async ({ method, config, expected }) => {
    const { createPlaylist, getPlaylistWithTracks, updatePlaylist } = vi.mocked(
      await import('@/db/queries/playlists'),
    )
    getPlaylistWithTracks.mockResolvedValue({
      playlist: {
        ...mockPlaylist,
        config: { size: 88, mood: 'old', trackSourcePriority: ['local'] },
      },
      tracks: [],
    } as never)
    const deps = makeDeps()
    const res = await createTestApp(deps, USER_ID).request(requestPath(method), {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody(method, config)),
    })
    expect(res.status).toBe(method === 'POST' ? 201 : 204)
    const saved =
      method === 'POST' ? createPlaylist.mock.calls[0]?.[1] : updatePlaylist.mock.calls[0]?.[2]
    expect(saved).toHaveProperty('config', expected)
    expect(deps.restartPlaylistScheduler).toHaveBeenCalledOnce()
  })

  it.each(
    methods.flatMap((method) => [
      { method, config: undefined },
      { method, config: null },
    ]),
  )('$method preserves omitted/null config $config', async ({ method, config }) => {
    const { createPlaylist, updatePlaylist } = vi.mocked(await import('@/db/queries/playlists'))
    const res = await createTestApp(makeDeps(), USER_ID).request(requestPath(method), {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody(method, config)),
    })
    expect(res.status).toBe(method === 'POST' ? 201 : 204)
    if (method === 'PATCH' && config === undefined) {
      expect(updatePlaylist).not.toHaveBeenCalled()
      return
    }
    const saved =
      method === 'POST' ? createPlaylist.mock.calls[0]?.[1] : updatePlaylist.mock.calls[0]?.[2]
    expect(saved).toHaveProperty('config', null)
  })

  it.each(
    methods.flatMap((method) =>
      [
        { size: 0 },
        { size: -1 },
        { size: 1.5 },
        { size: '25' },
        { size: null },
        { trackSourcePriority: 'spotify' },
        { trackSourcePriority: ['invalid'] },
        { genre: 1 },
        { mood: null },
        { unknown: true },
        [],
      ].map((config) => ({ method, config })),
    ),
  )('$method rejects invalid config $config before writes', async ({ method, config }) => {
    const { createPlaylist, updatePlaylist } = vi.mocked(await import('@/db/queries/playlists'))
    const deps = makeDeps()
    const res = await createTestApp(deps, USER_ID).request(requestPath(method), {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody(method, config)),
    })
    expect(res.status).toBe(400)
    expect(createPlaylist).not.toHaveBeenCalled()
    expect(updatePlaylist).not.toHaveBeenCalled()
    expect(deps.restartPlaylistScheduler).not.toHaveBeenCalled()
  })
})

describe('GET /api/v1/playlists/:id', () => {
  it('returns playlist with tracks for owner', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/v1/playlists/1')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { playlist: unknown; tracks: unknown[] }
    expect(body.playlist).toBeDefined()
    expect(Array.isArray(body.tracks)).toBe(true)
    expect(body).toHaveProperty('generation', null)
    const { getLatestPlaylistGeneration } = vi.mocked(await import('@/db/queries/jobs'))
    expect(getLatestPlaylistGeneration).toHaveBeenCalledWith(mockDb, 1, USER_ID)
  })

  it('returns the latest failed run without inventing an older resolution', async () => {
    const { getLatestPlaylistGeneration } = vi.mocked(await import('@/db/queries/jobs'))
    getLatestPlaylistGeneration.mockResolvedValue({
      jobId: 8,
      status: 'failed',
      startedAt: new Date('2026-01-01'),
      completedAt: new Date('2026-01-01'),
      resolution: null,
    })
    const res = await createTestApp(makeDeps(), USER_ID).request('/api/v1/playlists/1')
    expect(res.status).toBe(200)
    expect(await res.json()).toHaveProperty('generation', {
      jobId: 8,
      status: 'failed',
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:00:00.000Z',
      resolution: null,
    })
  })

  it.each([
    {
      matches: [{ artistName: 'Radiohead', artistMbid: 'artist-1', recommendationId: 12 }],
      expected: 12,
    },
    {
      matches: [{ artistName: 'Radiohead', artistMbid: 'artist-1', recommendationId: null }],
      expected: undefined,
    },
    {
      matches: [
        { artistName: 'Radiohead', artistMbid: 'artist-1', recommendationId: 12 },
        { artistName: 'Radiohead', artistMbid: 'artist-2', recommendationId: null },
      ],
      expected: undefined,
    },
  ])(
    'maps Audition approvals only for an unambiguous pending artist: $expected',
    async ({ matches, expected }) => {
      const { getPlaylistWithTracks } = vi.mocked(await import('@/db/queries/playlists'))
      getPlaylistWithTracks.mockResolvedValue({
        playlist: { ...mockPlaylist, strategy: 'audition' },
        tracks: [mockTrack],
      } as never)
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(matches) }),
        }),
      })
      const res = await createTestApp(makeDeps(), USER_ID).request('/api/v1/playlists/1')
      expect(res.status).toBe(200)
      expect(
        ((await res.json()) as { tracks: Array<{ recommendationId?: number }> }).tracks[0]
          ?.recommendationId,
      ).toBe(expected)
    },
  )

  it('hides cross-user playlist with 404', async () => {
    const app = createTestApp(makeDeps(), 999) // different user
    const res = await app.request('/api/v1/playlists/1')
    expect(res.status).toBe(404)
    const { getLatestPlaylistGeneration } = vi.mocked(await import('@/db/queries/jobs'))
    expect(getLatestPlaylistGeneration).not.toHaveBeenCalled()
    expect(mockDb.select).not.toHaveBeenCalled()
  })

  it('returns 404 for missing playlist', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/v1/playlists/9999')
    expect(res.status).toBe(404)
  })

  it('returns the same hidden 404 body for missing and cross-user playlists', async () => {
    const missing = await createTestApp(makeDeps(), USER_ID).request('/api/v1/playlists/9999')
    const crossUser = await createTestApp(makeDeps(), 999).request('/api/v1/playlists/1')

    expect(missing.status).toBe(404)
    expect(crossUser.status).toBe(404)
    expect(missing.headers.get('content-type')).toContain('application/problem+json')
    expect(crossUser.headers.get('content-type')).toContain('application/problem+json')
    expect(await crossUser.text()).toBe(await missing.text())
  })
})

describe('GET /api/v1/playlists/:id/export/:format', () => {
  it('exports a playlist as M3U for the owner', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/v1/playlists/1/export/m3u')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('audio/x-mpegurl')
    expect(res.headers.get('content-disposition')).toContain('weekly-mix.m3u')
    const body = await res.text()
    expect(body).toContain('#EXTM3U')
    expect(body).toContain('Radiohead - Creep')
  })

  it('exports a playlist as XSPF for the owner', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/v1/playlists/1/export/xspf')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/xspf+xml')
    const body = await res.text()
    expect(body).toContain('<?xml')
    expect(body).toContain('<title>Weekly Mix</title>')
  })

  it('returns 400 for unsupported export format', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/v1/playlists/1/export/xml')
    expect(res.status).toBe(400)
  })

  it('hides cross-user playlist with 404 export access', async () => {
    const app = createTestApp(makeDeps(), 999)
    const res = await app.request('/api/v1/playlists/1/export/m3u')
    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/v1/playlists/:id', () => {
  it('updates allowed fields for owner', async () => {
    const deps = makeDeps()
    const app = createTestApp(deps, USER_ID)
    const res = await app.request('/api/v1/playlists/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated Mix', enabled: false }),
    })
    expect(res.status).toBe(204)
    expect(deps.restartPlaylistScheduler).toHaveBeenCalledOnce()
  })

  it('hides cross-user playlist with 404', async () => {
    const app = createTestApp(makeDeps(), 999)
    const res = await app.request('/api/v1/playlists/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'hack' }),
    })
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/v1/playlists/:id', () => {
  it('deletes playlist for owner', async () => {
    const deps = makeDeps()
    const app = createTestApp(deps, USER_ID)
    const res = await app.request('/api/v1/playlists/1', { method: 'DELETE' })
    expect(res.status).toBe(204)
    expect(deps.restartPlaylistScheduler).toHaveBeenCalledOnce()
  })

  it('hides cross-user playlist with 404', async () => {
    const app = createTestApp(makeDeps(), 999)
    const res = await app.request('/api/v1/playlists/1', { method: 'DELETE' })
    expect(res.status).toBe(404)
  })
})

describe('POST /api/v1/playlists/:id/generate', () => {
  it('returns 202 and fires generation for owner', async () => {
    const deps = makeDeps()
    const app = createTestApp(deps, USER_ID)
    const res = await app.request('/api/v1/playlists/1/generate', { method: 'POST' })
    expect(res.status).toBe(202)
    const body = (await res.json()) as { status: string }
    expect(body.status).toBe('generating')
    expect(deps.runPlaylistGeneration).toHaveBeenCalledWith(1)
  })

  it('hides cross-user playlist with 404', async () => {
    const app = createTestApp(makeDeps(), 999)
    const res = await app.request('/api/v1/playlists/1/generate', { method: 'POST' })
    expect(res.status).toBe(404)
  })

  it('returns 404 for missing playlist', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/v1/playlists/9999/generate', { method: 'POST' })
    expect(res.status).toBe(404)
  })
})

describe('saved playlist export recovery', () => {
  const binding = {
    id: 10,
    playlistId: 1,
    targetId: 7,
    remotePlaylistId: 'remote-7',
    remoteScope: 'v1:account',
    state: 'linked' as const,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
  }
  const resetRequest = (body: unknown = { acknowledgePossibleDuplicate: true }) => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  it('lists only the owned binding projection and resets only local state after acknowledgment', async () => {
    const queries = vi.mocked(await import('@/db/queries/playlist-exports'))
    queries.getPlaylistExports.mockResolvedValue([binding])
    queries.getPlaylistExport.mockResolvedValue(binding)
    const app = createTestApp(makeDeps(), USER_ID)
    const result = await app.request('/api/v1/playlists/1/exports')
    expect(result.status).toBe(200)
    expect(await result.json()).toEqual({
      exports: [
        {
          targetId: 7,
          remotePlaylistId: 'remote-7',
          state: 'linked',
          updatedAt: binding.updatedAt.toISOString(),
        },
      ],
    })
    expect(queries.getPlaylistExports).toHaveBeenCalledWith(mockDb, USER_ID, 1)
    expect((await app.request('/api/v1/playlists/1/exports/7/reset', resetRequest())).status).toBe(
      204,
    )
    expect(queries.resetPlaylistExport).toHaveBeenCalledWith(mockDb, USER_ID, 1, 7)
  })

  it.each([
    { userId: undefined, status: 401 },
    { userId: 999, status: 404 },
  ])(
    'refuses another user or anonymous access ($status) before reading bindings',
    async ({ userId, status }) => {
      const queries = vi.mocked(await import('@/db/queries/playlist-exports'))
      const app = createTestApp(makeDeps(), userId)
      expect((await app.request('/api/v1/playlists/1/exports')).status).toBe(status)
      expect(
        (await app.request('/api/v1/playlists/1/exports/7/reset', resetRequest())).status,
      ).toBe(status)
      expect(queries.getPlaylistExports).not.toHaveBeenCalled()
      expect(queries.getPlaylistExport).not.toHaveBeenCalled()
      expect(queries.resetPlaylistExport).not.toHaveBeenCalled()
    },
  )

  it.each([
    {},
    { acknowledgePossibleDuplicate: false },
    { acknowledgePossibleDuplicate: true, extra: true },
  ])('requires explicit acknowledgment and rejects unknown recovery fields: %j', async (body) => {
    const queries = vi.mocked(await import('@/db/queries/playlist-exports'))
    const response = await createTestApp(makeDeps(), USER_ID).request(
      '/api/v1/playlists/1/exports/7/reset',
      resetRequest(body),
    )
    expect(response.status).toBe(400)
    expect(queries.resetPlaylistExport).not.toHaveBeenCalled()
  })

  it('refuses missing or transferred target bindings and blocks reset during generation', async () => {
    const queries = vi.mocked(await import('@/db/queries/playlist-exports'))
    const app = createTestApp(makeDeps(), USER_ID)
    expect((await app.request('/api/v1/playlists/1/exports/7/reset', resetRequest())).status).toBe(
      404,
    )
    queries.getPlaylistExport.mockResolvedValue(binding)
    const response = await withPlaylistLock(1, async () =>
      app.request('/api/v1/playlists/1/exports/7/reset', resetRequest()),
    )
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'errors.playlist.busy' })
    expect(queries.resetPlaylistExport).not.toHaveBeenCalled()
  })
})
