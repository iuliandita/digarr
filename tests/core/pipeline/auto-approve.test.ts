// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { type AutoApproveDeps, autoApprove } from '@/core/pipeline/auto-approve'

function makeDeps(overrides: Partial<AutoApproveDeps> = {}): AutoApproveDeps {
  return {
    getRecommendationsByBatch: vi.fn().mockResolvedValue([
      { id: 1, score: 0.9, status: 'pending', artist: { mbid: 'mbid-1', name: 'Artist A' } },
      { id: 2, score: 0.6, status: 'pending', artist: { mbid: 'mbid-2', name: 'Artist B' } },
      { id: 3, score: 0.4, status: 'pending', artist: { mbid: 'mbid-3', name: 'Artist C' } },
    ]),
    getEnabledTargets: vi.fn().mockResolvedValue([
      {
        id: 'lidarr-1',
        name: 'Lidarr',
        type: 'lidarr',
        capabilities: ['addArtist'],
        addArtist: vi.fn().mockResolvedValue({
          success: true,
          targetType: 'lidarr',
          targetId: 1,
          externalId: 99,
        }),
        testConnection: vi.fn(),
      },
    ]),
    updateRecommendationStatus: vi.fn(),
    warmArtist: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('autoApprove()', () => {
  it('approves recommendations above threshold via targets', async () => {
    const deps = makeDeps()
    const result = await autoApprove(
      1,
      {
        threshold: 0.7,
        monitorOption: 'all',
        qualityProfileId: 1,
        metadataProfileId: 1,
        rootFolderId: 1,
      },
      deps,
    )

    expect(result.approved).toBe(1) // only score 0.9 is above 0.7
    const targets = await deps.getEnabledTargets()
    const target = targets[0]
    if (!target) throw new Error('expected at least one target')
    expect(target.addArtist).toHaveBeenCalledTimes(1)
    expect(target.addArtist).toHaveBeenCalledWith(
      { mbid: 'mbid-1', name: 'Artist A' },
      expect.objectContaining({ monitorOption: 'all', qualityProfileId: 1 }),
    )
  })

  it('skips non-pending recommendations', async () => {
    const deps = makeDeps({
      getRecommendationsByBatch: vi
        .fn()
        .mockResolvedValue([
          { id: 1, score: 0.9, status: 'rejected', artist: { mbid: 'mbid-1', name: 'A' } },
        ]),
    })
    const result = await autoApprove(
      1,
      {
        threshold: 0.5,
        monitorOption: 'all',
        qualityProfileId: 1,
        metadataProfileId: 1,
        rootFolderId: 1,
      },
      deps,
    )
    expect(result.approved).toBe(0)
  })

  it('handles no targets gracefully', async () => {
    const deps = makeDeps({
      getEnabledTargets: vi.fn().mockResolvedValue([]),
    })
    const result = await autoApprove(
      1,
      {
        threshold: 0.5,
        monitorOption: 'all',
        qualityProfileId: 1,
        metadataProfileId: 1,
        rootFolderId: 1,
      },
      deps,
    )
    // With no targets, marks as 'approved' (discovery-only mode)
    expect(result.approved).toBe(2)
    expect(deps.updateRecommendationStatus).toHaveBeenCalledWith(
      1,
      'approved',
      expect.objectContaining({ targetActions: {} }),
    )
  })

  it('continues on individual target failure', async () => {
    const failTarget = {
      id: 'lidarr-1',
      name: 'Lidarr',
      type: 'lidarr' as const,
      capabilities: ['addArtist' as const],
      addArtist: vi
        .fn()
        .mockResolvedValueOnce({ success: true, targetType: 'lidarr', targetId: 1, externalId: 10 })
        .mockResolvedValueOnce({
          success: false,
          targetType: 'lidarr',
          targetId: 1,
          error: 'Already exists',
        }),
      testConnection: vi.fn(),
    }
    const deps = makeDeps({
      getEnabledTargets: vi.fn().mockResolvedValue([failTarget]),
      getRecommendationsByBatch: vi.fn().mockResolvedValue([
        { id: 1, score: 0.9, status: 'pending', artist: { mbid: 'mbid-1', name: 'A' } },
        { id: 2, score: 0.8, status: 'pending', artist: { mbid: 'mbid-2', name: 'B' } },
      ]),
    })
    const result = await autoApprove(
      1,
      {
        threshold: 0.5,
        monitorOption: 'all',
        qualityProfileId: 1,
        metadataProfileId: 1,
        rootFolderId: 1,
      },
      deps,
    )
    expect(result.approved).toBe(1)
    expect(result.failed).toBe(1)
  })

  it('marks add_failed when Lidarr target exists but addArtist failed', async () => {
    const deps = makeDeps({
      getEnabledTargets: vi.fn().mockResolvedValue([
        {
          id: 'lidarr-1',
          name: 'Lidarr',
          type: 'lidarr',
          capabilities: ['addArtist'],
          addArtist: vi.fn().mockResolvedValue({
            success: false,
            targetType: 'lidarr',
            targetId: 1,
            error: 'connection refused',
          }),
          testConnection: vi.fn(),
        },
      ]),
      getRecommendationsByBatch: vi
        .fn()
        .mockResolvedValue([
          { id: 1, score: 0.9, status: 'pending', artist: { mbid: 'mbid-1', name: 'A' } },
        ]),
    })
    const result = await autoApprove(
      1,
      {
        threshold: 0.5,
        monitorOption: 'all',
        qualityProfileId: 1,
        metadataProfileId: 1,
        rootFolderId: 1,
      },
      deps,
    )
    expect(result.approved).toBe(0)
    expect(result.failed).toBe(1)
    expect(deps.updateRecommendationStatus).toHaveBeenCalledWith(
      1,
      'add_failed',
      expect.objectContaining({ lidarrError: 'connection refused' }),
    )
  })

  it('sets added_to_lidarr only when the Lidarr target actually succeeded', async () => {
    // Regression guard: prior code keyed final status off `hasLidarr` (target presence),
    // so a succeeding non-Lidarr target alongside a failing Lidarr target could yield
    // `added_to_lidarr`. With Lidarr failing, the status must NOT be `added_to_lidarr`.
    const deps = makeDeps({
      getEnabledTargets: vi.fn().mockResolvedValue([
        {
          id: 'lidarr-1',
          name: 'Lidarr',
          type: 'lidarr',
          capabilities: ['addArtist'],
          addArtist: vi.fn().mockResolvedValue({
            success: false,
            targetType: 'lidarr',
            targetId: 1,
            error: 'lidarr down',
          }),
          testConnection: vi.fn(),
        },
        {
          id: 'emby-1',
          name: 'Emby',
          type: 'emby',
          capabilities: ['addArtist'],
          addArtist: vi.fn().mockResolvedValue({
            success: true,
            targetType: 'emby',
            targetId: 2,
            externalId: 'emby-artist-1',
          }),
          testConnection: vi.fn(),
        },
      ]),
      getRecommendationsByBatch: vi
        .fn()
        .mockResolvedValue([
          { id: 1, score: 0.9, status: 'pending', artist: { mbid: 'mbid-1', name: 'A' } },
        ]),
    })
    await autoApprove(
      1,
      {
        threshold: 0.5,
        monitorOption: 'all',
        qualityProfileId: 1,
        metadataProfileId: 1,
        rootFolderId: 1,
      },
      deps,
    )
    // Lidarr is authoritative: if its add failed, status must NOT be added_to_lidarr
    // even when a secondary target succeeded. Caller treats this as a failure.
    const mock = deps.updateRecommendationStatus as ReturnType<typeof vi.fn>
    const firstCall = mock.mock.calls[0]
    if (!firstCall) throw new Error('expected updateRecommendationStatus to be called')
    const finalStatus = firstCall[1]
    expect(finalStatus).not.toBe('added_to_lidarr')
    expect(finalStatus).toBe('add_failed')
  })

  it('uses approved status when no Lidarr target is configured', async () => {
    const deps = makeDeps({
      getEnabledTargets: vi.fn().mockResolvedValue([
        {
          id: 'emby-1',
          name: 'Emby',
          type: 'emby',
          capabilities: ['addArtist'],
          addArtist: vi.fn().mockResolvedValue({
            success: true,
            targetType: 'emby',
            targetId: 2,
            externalId: 'emby-artist-1',
          }),
          testConnection: vi.fn(),
        },
      ]),
      getRecommendationsByBatch: vi
        .fn()
        .mockResolvedValue([
          { id: 1, score: 0.9, status: 'pending', artist: { mbid: 'mbid-1', name: 'A' } },
        ]),
    })
    const result = await autoApprove(
      1,
      {
        threshold: 0.5,
        monitorOption: 'all',
        qualityProfileId: 1,
        metadataProfileId: 1,
        rootFolderId: 1,
      },
      deps,
    )
    expect(result.approved).toBe(1)
    expect(deps.updateRecommendationStatus).toHaveBeenCalledWith(1, 'approved', expect.any(Object))
  })
})
