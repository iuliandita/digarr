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

vi.mock('@/db/queries/playlists', () => ({
  createPlaylist: vi.fn(async () => ({ id: 1 })),
  getPlaylistsByUser: vi.fn(async () => []),
  getPlaylistWithTracks: vi.fn(async (_db, id: number) =>
    id === 1
      ? ({
          playlist: {
            id: 1,
            userId: 1,
            name: 'Weekly',
            strategy: 'weekly_digest',
            targetIds: [],
            schedule: null,
            config: { size: 25, trackSourcePriority: ['spotify'] },
            lastGeneratedAt: null,
            trackCount: 0,
            enabled: true,
            createdAt: new Date('2024-01-01'),
          },
          tracks: [],
        } as const)
      : null,
  ),
  updatePlaylist: vi.fn(async () => {}),
  deletePlaylist: vi.fn(async () => {}),
  replacePlaylistTracks: vi.fn(async () => {}),
  getPlaylistsDueForGeneration: vi.fn(async () => []),
}))

describe('API routes: playlists', () => {
  it('creates a playlist when playlist routes are mounted', async () => {
    const { app } = createTestApp({
      playlistDeps: {
        db: {} as never,
        playlistScheduler: { listJobs: vi.fn(() => []), stopAll: vi.fn() } as never,
        runPlaylistGeneration: vi.fn(async () => {}),
        restartPlaylistScheduler: vi.fn(async () => {}),
      },
    })

    const createRes = await app.request('/api/v1/playlists', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer tok',
      },
      body: JSON.stringify({
        name: 'Weekly',
        strategy: 'weekly_digest',
        config: { size: 25, trackSourcePriority: ['spotify'] },
      }),
    })
    expect(createRes.status).toBe(201)
    const body = await createRes.json()
    expect(body.id).toBe(1)
  })

  it('starts playlist generation for an existing playlist', async () => {
    const runPlaylistGeneration = vi.fn(async () => {})
    const { app } = createTestApp({
      playlistDeps: {
        db: {} as never,
        playlistScheduler: { listJobs: vi.fn(() => []), stopAll: vi.fn() } as never,
        runPlaylistGeneration,
        restartPlaylistScheduler: vi.fn(async () => {}),
      },
    })

    const generateRes = await app.request('/api/v1/playlists/1/generate', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok' },
    })

    expect(generateRes.status).toBe(202)
  })

  it('returns 404 for playlist routes when playlistDeps is absent', async () => {
    const { app } = createTestApp({ playlistDeps: undefined })

    const createRes = await app.request('/api/v1/playlists', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer tok',
      },
      body: JSON.stringify({
        name: 'Weekly',
        strategy: 'weekly_digest',
        config: {},
      }),
    })
    expect(createRes.status).toBe(404)
  })

  it('returns playlist list when playlistDeps is absent', async () => {
    const { app } = createTestApp({ playlistDeps: undefined })

    const listRes = await app.request('/api/v1/playlists', {
      headers: { Authorization: 'Bearer tok' },
    })
    // Without playlistDeps the route is not mounted
    expect(listRes.status).toBe(404)
  })
})
