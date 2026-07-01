// @vitest-environment node

import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '@/server/types'

const mockDeps = {
  db: {} as never,
  getRecommendation: vi.fn(),
  updateRecommendationStatus: vi.fn().mockResolvedValue(undefined),
  rejectRecommendation: vi.fn().mockResolvedValue(1),
  listArtistBlocks: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
  removeArtistBlock: vi.fn().mockResolvedValue(true),
  addArtistBlock: vi.fn().mockResolvedValue(undefined),
  bulkUpdateStatus: vi.fn().mockResolvedValue(undefined),
  filterOwnedIds: vi.fn(async (ids: number[]) => ids),
  listRecommendations: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  getSettings: vi.fn().mockResolvedValue({ preferences: {} }),
  getUserById: vi.fn().mockResolvedValue(null),
  skyhookWarmer: null,
  getEnabledTargetsForUser: vi.fn().mockResolvedValue([]),
}

const { recommendationRoutes } = await import('@/server/routes/recommendations')

function createTestApp() {
  const app = new Hono<HonoEnv>()
  app.use('*', async (c, next) => {
    c.set('userId', 1)
    await next()
  })
  app.route('/', recommendationRoutes(mockDeps as never))
  return app
}

describe('target-aware approval', () => {
  beforeEach(() => vi.clearAllMocks())

  it('approves without targets - sets status to approved', async () => {
    mockDeps.getRecommendation.mockResolvedValue({
      id: 1,
      artist: { mbid: 'mbid-1', name: 'Radiohead' },
    })
    mockDeps.getEnabledTargetsForUser.mockResolvedValue([])

    const app = createTestApp()
    const res = await app.request('/api/v1/recommendations/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('approved')
    expect(mockDeps.updateRecommendationStatus).toHaveBeenCalledWith(
      1,
      'approved',
      expect.objectContaining({ targetActions: {} }),
    )
  })

  it('approves with Lidarr target - adds to Lidarr and sets added_to_lidarr', async () => {
    mockDeps.getRecommendation.mockResolvedValue({
      id: 1,
      artist: { mbid: 'mbid-1', name: 'Radiohead' },
    })
    const mockTarget = {
      id: 'lidarr-1',
      type: 'lidarr',
      capabilities: ['addArtist'],
      addArtist: vi.fn().mockResolvedValue({
        success: true,
        targetType: 'lidarr',
        targetId: 1,
        externalId: 42,
      }),
    }
    mockDeps.getEnabledTargetsForUser.mockResolvedValue([mockTarget])

    const app = createTestApp()
    const res = await app.request('/api/v1/recommendations/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    })

    const body = await res.json()
    expect(body.status).toBe('added_to_lidarr')
    expect(mockTarget.addArtist).toHaveBeenCalledWith(
      { mbid: 'mbid-1', name: 'Radiohead' },
      expect.any(Object),
    )
  })

  it('partial Lidarr add (artist added, album not monitored) persists the artist link and warns, not orphaned', async () => {
    mockDeps.getRecommendation.mockResolvedValue({
      id: 1,
      artist: { mbid: 'mbid-1', name: 'Radiohead' },
    })
    const mockTarget = {
      id: 'lidarr-1',
      name: 'Lidarr',
      type: 'lidarr',
      capabilities: ['addArtist'],
      addArtist: vi.fn().mockResolvedValue({
        success: true,
        targetType: 'lidarr',
        targetId: 1,
        externalId: 42,
        warning: 'artist added, but the selected album was not found in Lidarr',
      }),
    }
    mockDeps.getEnabledTargetsForUser.mockResolvedValue([mockTarget])

    const app = createTestApp()
    const res = await app.request('/api/v1/recommendations/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    })

    const body = await res.json()
    // The artist link must persist (no orphan -> retry reconciles, no duplicate).
    expect(body.status).toBe('added_to_lidarr')
    expect(mockDeps.updateRecommendationStatus).toHaveBeenCalledWith(
      1,
      'added_to_lidarr',
      expect.objectContaining({ lidarrArtistId: 42 }),
    )
    // The partial outcome is surfaced, not silent.
    expect(body.targetSummary.warnings).toContain(
      'artist added, but the selected album was not found in Lidarr',
    )
  })

  it('approves with failing Lidarr target - sets add_failed', async () => {
    mockDeps.getRecommendation.mockResolvedValue({
      id: 1,
      artist: { mbid: 'mbid-1', name: 'Radiohead' },
    })
    const mockTarget = {
      id: 'lidarr-1',
      type: 'lidarr',
      capabilities: ['addArtist'],
      addArtist: vi.fn().mockResolvedValue({
        success: false,
        targetType: 'lidarr',
        targetId: 1,
        error: 'Already exists',
      }),
    }
    mockDeps.getEnabledTargetsForUser.mockResolvedValue([mockTarget])

    const app = createTestApp()
    const res = await app.request('/api/v1/recommendations/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    })

    const body = await res.json()
    expect(body.status).toBe('add_failed')
  })

  it('approves with createPlaylist-only targets - sets approved', async () => {
    mockDeps.getRecommendation.mockResolvedValue({
      id: 1,
      artist: { mbid: 'mbid-1', name: 'Radiohead' },
    })
    const spotifyTarget = {
      id: 'spotify-playlist-1',
      type: 'spotify-playlist',
      capabilities: ['createPlaylist'],
      createPlaylist: vi.fn(),
      testConnection: vi.fn(),
    }
    mockDeps.getEnabledTargetsForUser.mockResolvedValue([spotifyTarget])

    const app = createTestApp()
    const res = await app.request('/api/v1/recommendations/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    })

    const body = await res.json()
    expect(body.status).toBe('approved')
    expect(mockDeps.updateRecommendationStatus).toHaveBeenCalledWith(
      1,
      'approved',
      expect.objectContaining({ targetActions: {} }),
    )
    expect(spotifyTarget.createPlaylist).not.toHaveBeenCalled()
  })

  it('approves to specific target via targetId', async () => {
    mockDeps.getRecommendation.mockResolvedValue({
      id: 1,
      artist: { mbid: 'mbid-1', name: 'Radiohead' },
    })
    const lidarrTarget1 = {
      id: 'lidarr-1',
      type: 'lidarr',
      capabilities: ['addArtist'],
      addArtist: vi.fn().mockResolvedValue({
        success: true,
        targetType: 'lidarr',
        targetId: 1,
        externalId: 42,
      }),
      testConnection: vi.fn(),
    }
    const lidarrTarget2 = {
      id: 'lidarr-2',
      type: 'lidarr',
      capabilities: ['addArtist'],
      addArtist: vi.fn().mockResolvedValue({
        success: true,
        targetType: 'lidarr',
        targetId: 2,
        externalId: 99,
      }),
      testConnection: vi.fn(),
    }
    mockDeps.getEnabledTargetsForUser.mockResolvedValue([lidarrTarget1, lidarrTarget2])

    const app = createTestApp()
    const res = await app.request('/api/v1/recommendations/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved', targetId: 'lidarr-2' }),
    })

    const body = await res.json()
    expect(body.status).toBe('added_to_lidarr')
    // Only lidarr-2 should be called
    expect(lidarrTarget2.addArtist).toHaveBeenCalled()
    expect(lidarrTarget1.addArtist).not.toHaveBeenCalled()
  })

  it('handles multiple addArtist targets', async () => {
    mockDeps.getRecommendation.mockResolvedValue({
      id: 1,
      artist: { mbid: 'mbid-1', name: 'Radiohead' },
    })
    const lidarrTarget1 = {
      id: 'lidarr-1',
      type: 'lidarr',
      capabilities: ['addArtist'],
      addArtist: vi.fn().mockResolvedValue({
        success: true,
        targetType: 'lidarr',
        targetId: 1,
        externalId: 42,
      }),
      testConnection: vi.fn(),
    }
    const lidarrTarget2 = {
      id: 'lidarr-2',
      type: 'lidarr',
      capabilities: ['addArtist'],
      addArtist: vi.fn().mockResolvedValue({
        success: true,
        targetType: 'lidarr',
        targetId: 2,
        externalId: 99,
      }),
      testConnection: vi.fn(),
    }
    mockDeps.getEnabledTargetsForUser.mockResolvedValue([lidarrTarget1, lidarrTarget2])

    const app = createTestApp()
    const res = await app.request('/api/v1/recommendations/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    })

    const body = await res.json()
    expect(body.status).toBe('added_to_lidarr')
    expect(lidarrTarget1.addArtist).toHaveBeenCalled()
    expect(lidarrTarget2.addArtist).toHaveBeenCalled()
    expect(body.targetActions['lidarr-1'].status).toBe('added')
    expect(body.targetActions['lidarr-2'].status).toBe('added')
  })

  it('bulk approve with addArtist targets', async () => {
    mockDeps.getRecommendation.mockResolvedValue({
      id: 1,
      artist: { mbid: 'mbid-1', name: 'Radiohead' },
    })
    const mockTarget = {
      id: 'lidarr-1',
      type: 'lidarr',
      capabilities: ['addArtist'],
      addArtist: vi.fn().mockResolvedValue({
        success: true,
        targetType: 'lidarr',
        targetId: 1,
        externalId: 42,
      }),
      testConnection: vi.fn(),
    }
    mockDeps.getEnabledTargetsForUser.mockResolvedValue([mockTarget])

    const app = createTestApp()
    const res = await app.request('/api/v1/recommendations/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [1], action: 'approve' }),
    })

    const body = await res.json()
    expect(body.results[0].status).toBe('added_to_lidarr')
    expect(mockTarget.addArtist).toHaveBeenCalledWith(
      { mbid: 'mbid-1', name: 'Radiohead' },
      expect.any(Object),
    )
  })

  it('bulk approve without targets marks all as approved', async () => {
    mockDeps.getRecommendation.mockResolvedValue({
      id: 1,
      artist: { mbid: 'mbid-1', name: 'Radiohead' },
    })
    mockDeps.getEnabledTargetsForUser.mockResolvedValue([])

    const app = createTestApp()
    const res = await app.request('/api/v1/recommendations/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [1], action: 'approve' }),
    })

    const body = await res.json()
    expect(body.results[0].status).toBe('approved')
  })

  it('bulk approve with createPlaylist-only targets marks all as approved', async () => {
    mockDeps.getRecommendation.mockResolvedValue({
      id: 1,
      artist: { mbid: 'mbid-1', name: 'Radiohead' },
    })
    const spotifyTarget = {
      id: 'spotify-playlist-1',
      type: 'spotify-playlist',
      capabilities: ['createPlaylist'],
      createPlaylist: vi.fn(),
      testConnection: vi.fn(),
    }
    mockDeps.getEnabledTargetsForUser.mockResolvedValue([spotifyTarget])

    const app = createTestApp()
    const res = await app.request('/api/v1/recommendations/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [1], action: 'approve' }),
    })

    const body = await res.json()
    expect(body.results[0].status).toBe('approved')
    expect(spotifyTarget.createPlaylist).not.toHaveBeenCalled()
  })

  it('returns a per-target summary on partial failure', async () => {
    mockDeps.getRecommendation.mockResolvedValue({
      id: 1,
      artist: { mbid: 'mbid-1', name: 'Radiohead' },
    })
    mockDeps.getEnabledTargetsForUser.mockResolvedValue([
      {
        id: 'lidarr-1',
        type: 'lidarr',
        name: 'Lidarr Primary',
        capabilities: ['addArtist'],
        addArtist: vi.fn().mockResolvedValue({ success: true, externalId: 42 }),
      },
      {
        id: 'lidarr-2',
        type: 'lidarr',
        name: 'Lidarr Backup',
        capabilities: ['addArtist'],
        addArtist: vi.fn().mockResolvedValue({ success: false, error: 'connection refused' }),
      },
    ])

    const app = createTestApp()
    const res = await app.request('/api/v1/recommendations/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    })

    const body = await res.json()
    expect(body.status).toBe('added_to_lidarr')
    expect(body.targetSummary).toEqual({
      total: 2,
      succeeded: 1,
      failed: 1,
      failures: [{ id: 'lidarr-2', name: 'Lidarr Backup', error: 'connection refused' }],
      warnings: [],
    })
  })

  it('retrying a failed target keeps prior successes and does not regress status', async () => {
    // Rec already has lidarr-1 succeeded, lidarr-2 failed.
    mockDeps.getRecommendation.mockResolvedValue({
      id: 1,
      artist: { mbid: 'mbid-1', name: 'Radiohead' },
      lidarrArtistId: 42,
      targetActions: {
        'lidarr-1': { status: 'added', externalId: 42 },
        'lidarr-2': { status: 'failed', error: 'connection refused' },
      },
    })
    mockDeps.getEnabledTargetsForUser.mockResolvedValue([
      {
        id: 'lidarr-1',
        type: 'lidarr',
        name: 'Lidarr Primary',
        capabilities: ['addArtist'],
        addArtist: vi.fn().mockResolvedValue({ success: true, externalId: 42 }),
      },
      {
        id: 'lidarr-2',
        type: 'lidarr',
        name: 'Lidarr Backup',
        capabilities: ['addArtist'],
        // Retry fails again.
        addArtist: vi.fn().mockResolvedValue({ success: false, error: 'still down' }),
      },
    ])

    const app = createTestApp()
    const res = await app.request('/api/v1/recommendations/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved', targetId: 'lidarr-2' }),
    })

    const body = await res.json()
    // lidarr-1 still counts, so the rec is not regressed to add_failed.
    expect(body.status).toBe('added_to_lidarr')
    expect(mockDeps.updateRecommendationStatus).toHaveBeenCalledWith(
      1,
      'added_to_lidarr',
      expect.objectContaining({
        targetActions: expect.objectContaining({
          'lidarr-1': { status: 'added', externalId: 42 },
          'lidarr-2': expect.objectContaining({ status: 'failed' }),
        }),
      }),
    )
    // Summary reflects only this attempt (the retried target).
    expect(body.targetSummary).toEqual({
      total: 1,
      succeeded: 0,
      failed: 1,
      failures: [{ id: 'lidarr-2', name: 'Lidarr Backup', error: 'still down' }],
      warnings: [],
    })
  })
})
