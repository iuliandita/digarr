// @vitest-environment node

import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppDependencies } from '@/server'
import { createApp } from '@/server'

// Hoist the mock so vitest can resolve it before imports
vi.mock('@/core/clients/lidarr', () => ({
  createLidarrClient: vi.fn(),
}))

import { createLidarrClient } from '@/core/clients/lidarr'

function makeMockOrchestrator() {
  const emitter = new EventEmitter()
  return Object.assign(emitter, {
    isRunning: false,
    run: vi.fn(async () => ({ batchId: 1 })),
  })
}

const mockArtist = {
  id: 10,
  mbid: 'mbid-abc-123',
  name: 'Test Artist',
  disambiguation: null,
  tags: null,
  genres: null,
  imageUrl: null,
  streamingUrls: null,
  cachedAt: new Date('2024-01-01'),
}

const mockRecommendation = {
  id: 1,
  artistId: 10,
  batchId: 1,
  score: 0.85,
  status: 'pending',
  sources: null,
  aiReasoning: null,
  reasons: [],
  lidarrArtistId: null,
  lidarrError: null,
  actedOnAt: null,
  createdAt: new Date('2024-01-01'),
  artist: mockArtist,
}

function makeDeps(overrides: Partial<AppDependencies> = {}): AppDependencies {
  return {
    db: { execute: vi.fn(async () => []) } as unknown as AppDependencies['db'],
    storeDb: {} as unknown as AppDependencies['storeDb'],
    orchestrator: makeMockOrchestrator() as unknown as AppDependencies['orchestrator'],
    scheduler: {} as AppDependencies['scheduler'],
    isSetupComplete: async () => true,
    getSettings: vi.fn(async () => ({
      id: 1,
      lidarrUrl: 'http://lidarr:8686',
      lidarrApiKey: 'key',
      preferences: { qualityProfileId: 1, rootFolderId: 1 },
    })),
    updateSettings: vi.fn(async () => {}),
    completeSetup: vi.fn(async () => ({ id: 1, setupComplete: true })),
    getLastBatch: vi.fn(async () => null),
    listRecommendations: vi.fn(async () => ({ items: [mockRecommendation], total: 1 })),
    getRecommendation: vi.fn(async (id: number) => (id === 1 ? mockRecommendation : null)),
    updateRecommendationStatus: vi.fn(async () => {}),
    bulkUpdateStatus: vi.fn(async () => {}),
    listBatches: vi.fn(async () => []),
    getBatch: vi.fn(async () => null),
    getArtistById: vi.fn(async () => null),
    ...overrides,
  }
}

const mockLidarrClient = {
  addArtist: vi.fn(),
  getQualityProfiles: vi.fn(async () => []),
  getMetadataProfiles: vi.fn(async () => []),
  getRootFolders: vi.fn(async () => []),
  getArtists: vi.fn(async () => []),
  lookupArtist: vi.fn(async () => []),
  testConnection: vi.fn(async () => ({ success: true, message: 'ok' })),
}

beforeEach(() => {
  vi.mocked(createLidarrClient).mockReturnValue(
    mockLidarrClient as ReturnType<typeof createLidarrClient>,
  )
  vi.clearAllMocks()
  vi.mocked(createLidarrClient).mockReturnValue(
    mockLidarrClient as ReturnType<typeof createLidarrClient>,
  )
})

describe('GET /api/recommendations', () => {
  it('returns list and total', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/recommendations')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.total).toBe(1)
    expect(body.items).toHaveLength(1)
    expect(body.items[0].id).toBe(1)
  })

  it('passes filters to listRecommendations', async () => {
    const listRecommendations = vi.fn(async () => ({ items: [], total: 0 }))
    const app = createApp(makeDeps({ listRecommendations }))
    await app.request('/api/recommendations?status=pending&limit=5&offset=10')
    expect(listRecommendations).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending', limit: 5, offset: 10 }),
    )
  })
})

describe('GET /api/recommendations/:id', () => {
  it('returns 200 with recommendation when found', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/recommendations/1')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe(1)
    expect(body.artist.mbid).toBe('mbid-abc-123')
  })

  it('returns 404 when not found', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/recommendations/999')
    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/recommendations/:id', () => {
  it('updates to rejected status without calling Lidarr', async () => {
    const updateRecommendationStatus = vi.fn(async () => {})
    const app = createApp(makeDeps({ updateRecommendationStatus }))
    const res = await app.request('/api/recommendations/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'rejected' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('rejected')
    expect(updateRecommendationStatus).toHaveBeenCalledWith(1, 'rejected')
  })

  it('approve triggers Lidarr add and sets added_to_lidarr on success', async () => {
    const updateRecommendationStatus = vi.fn(async () => {})
    mockLidarrClient.addArtist.mockResolvedValue({
      id: 99,
      artistName: 'Test Artist',
      foreignArtistId: 'mbid-abc-123',
      qualityProfileId: 1,
      rootFolderPath: '/music',
      monitored: true,
      status: 'continuing',
    })

    const app = createApp(makeDeps({ updateRecommendationStatus }))
    const res = await app.request('/api/recommendations/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('added_to_lidarr')
    expect(updateRecommendationStatus).toHaveBeenCalledWith(
      1,
      'added_to_lidarr',
      expect.objectContaining({ lidarrArtistId: 99 }),
    )
  })

  it('approve sets add_failed when Lidarr throws', async () => {
    const updateRecommendationStatus = vi.fn(async () => {})
    mockLidarrClient.addArtist.mockRejectedValue(new Error('Lidarr down'))

    const app = createApp(makeDeps({ updateRecommendationStatus }))
    const res = await app.request('/api/recommendations/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('add_failed')
    expect(body.lidarrError).toMatch(/lidarr down/i)
    expect(updateRecommendationStatus).toHaveBeenCalledWith(
      1,
      'add_failed',
      expect.objectContaining({ lidarrError: expect.any(String) }),
    )
  })

  it('returns 400 when status is missing', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/recommendations/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('returns 404 for approve when recommendation not found', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/recommendations/999', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    })
    expect(res.status).toBe(404)
  })
})

describe('POST /api/recommendations/bulk', () => {
  it('bulk rejects without calling Lidarr', async () => {
    const bulkUpdateStatus = vi.fn(async () => {})
    const app = createApp(makeDeps({ bulkUpdateStatus }))
    const res = await app.request('/api/recommendations/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [1, 2, 3], action: 'reject' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.updated).toBe(3)
    expect(bulkUpdateStatus).toHaveBeenCalledWith([1, 2, 3], 'rejected')
  })

  it('returns 400 for invalid action', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/recommendations/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [1], action: 'delete' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 for missing ids', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/recommendations/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [], action: 'reject' }),
    })
    expect(res.status).toBe(400)
  })
})
