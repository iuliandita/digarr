// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import type { SlskdSearchResult } from '@/core/clients/slskd'
import { createSlskdOrchestrator } from '@/core/slskd/orchestrator'

const now = new Date('2026-04-13T12:00:00.000Z')

function makeJob(
  overrides: Partial<{
    id: number
    userId: number | null
    targetId: number
    recommendationId: number | null
    sourceType: string
    workKey: string
    artistMbid: string
    artistName: string
    releaseGroupMbid: string | null
    releaseTitle: string
    lidarrArtistId: number | null
    lidarrAlbumId: number | null
    state: 'pending' | 'searching' | 'queued' | 'downloading' | 'import_pending'
    confidence: number | null
    slskdSearchId: string | null
    slskdQueueId: string | null
    slskdDownloadId: string | null
    selectedResult: Record<string, unknown> | null
    lastError: string | null
    attempts: number
    completedAt: Date | null
    createdAt: Date
    updatedAt: Date
  }> = {},
) {
  return {
    id: overrides.id ?? 1,
    userId: overrides.userId ?? 1,
    targetId: overrides.targetId ?? 71,
    recommendationId: overrides.recommendationId ?? null,
    sourceType: overrides.sourceType ?? 'combined_approval',
    workKey: overrides.workKey ?? 'slskd:work',
    artistMbid: overrides.artistMbid ?? '11111111-1111-1111-1111-111111111111',
    artistName: overrides.artistName ?? 'Boards of Canada',
    releaseGroupMbid: overrides.releaseGroupMbid ?? 'rg-1',
    releaseTitle: overrides.releaseTitle ?? 'Music Has the Right to Children',
    lidarrArtistId: overrides.lidarrArtistId ?? null,
    lidarrAlbumId: overrides.lidarrAlbumId ?? null,
    state: overrides.state ?? 'pending',
    confidence: overrides.confidence ?? null,
    slskdSearchId: overrides.slskdSearchId ?? null,
    slskdQueueId: overrides.slskdQueueId ?? null,
    slskdDownloadId: overrides.slskdDownloadId ?? null,
    selectedResult: overrides.selectedResult ?? null,
    lastError: overrides.lastError ?? null,
    attempts: overrides.attempts ?? 0,
    completedAt: overrides.completedAt ?? null,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  }
}

function makeTarget(
  overrides: Partial<{
    id: number
    userId: number | null
    enabled: boolean
    type: string
    name: string
    config: Record<string, unknown>
  }> = {},
) {
  return {
    id: overrides.id ?? 71,
    userId: overrides.userId ?? 1,
    enabled: overrides.enabled ?? true,
    type: overrides.type ?? 'slskd',
    name: overrides.name ?? 'Soulseek',
    config: overrides.config ?? { url: 'http://slskd.local', apiKey: 'secret', lidarrTargetId: 12 },
  }
}

describe('createSlskdOrchestrator', () => {
  it('coalesces concurrent sync triggers into one pending-job sweep', async () => {
    let releaseListPendingJobs!: (jobs: Array<{ id: number }>) => void

    const listPendingJobs = vi.fn(
      () =>
        new Promise<Array<{ id: number }>>((resolve) => {
          releaseListPendingJobs = resolve
        }),
    )
    const processPendingJobs = vi.fn(async () => {})
    const orchestrator = createSlskdOrchestrator({
      listPendingJobs,
      processPendingJobs,
    })

    const firstTrigger = orchestrator.triggerSync()
    const secondTrigger = orchestrator.triggerSync()

    expect(orchestrator.isSyncing).toBe(true)
    expect(listPendingJobs).toHaveBeenCalledTimes(1)

    releaseListPendingJobs([{ id: 11 }, { id: 12 }])
    await Promise.all([firstTrigger, secondTrigger])

    expect(processPendingJobs).toHaveBeenCalledTimes(1)
    expect(processPendingJobs).toHaveBeenCalledWith([{ id: 11 }, { id: 12 }])
    expect(orchestrator.isSyncing).toBe(false)
  })

  it('ingests Lidarr wanted releases for enabled linked slskd targets and dedupes active work keys', async () => {
    const createJob = vi.fn(async () => makeJob({ id: 9 }))
    const findActiveJobByWorkKey = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeJob({ id: 8 }))
    const listTargets = vi.fn(async () => [
      makeTarget({
        id: 71,
        type: 'slskd',
        config: { url: 'http://slskd.local', apiKey: 'sl-key', lidarrTargetId: 12 },
      }),
      makeTarget({
        id: 12,
        type: 'lidarr',
        config: { url: 'http://lidarr.local', apiKey: 'li-key' },
      }),
    ])
    const lidarrClient = {
      getWantedMissing: vi.fn(async () => [
        {
          id: 501,
          title: 'Album A',
          foreignAlbumId: 'release-a',
          artistId: 100,
          artist: {
            id: 100,
            artistName: 'Artist One',
            foreignArtistId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          },
        },
        {
          id: 502,
          title: 'Album B',
          foreignAlbumId: 'release-b',
          artistId: 101,
          artist: {
            id: 101,
            artistName: 'Artist Two',
            foreignArtistId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          },
        },
      ]),
      getAlbums: vi.fn(async () => []),
    }

    const orchestrator = createSlskdOrchestrator({
      listPendingJobs: vi.fn(async () => []),
      processPendingJobs: vi.fn(async () => {}),
      listTargets,
      createLidarrClient: vi.fn(() => lidarrClient),
      findActiveJobByWorkKey,
      createJob,
    } as never)

    await orchestrator.triggerSync()

    expect(listTargets).toHaveBeenCalledTimes(1)
    expect(findActiveJobByWorkKey).toHaveBeenCalledTimes(2)
    expect(createJob).toHaveBeenCalledTimes(1)
    expect(createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: 71,
        sourceType: 'lidarr_wanted',
        artistName: 'Artist One',
        releaseTitle: 'Album A',
        releaseGroupMbid: 'release-a',
        lidarrAlbumId: 501,
        lidarrArtistId: 100,
      }),
    )
  })

  it('moves ambiguous matches to manual review instead of auto-queueing', async () => {
    const updateJobState = vi.fn(async () => makeJob())
    const updateRecommendationAction = vi.fn(async () => {})
    const slskdClient = {
      createSearch: vi.fn(async () => ({ id: 'search-1' })),
      getSearchResults: vi.fn(
        async (): Promise<SlskdSearchResult[]> => [
          { id: 'res-1', filename: 'Unknown - Maybe.flac', username: 'u1', size: 1000 },
          { id: 'res-2', filename: 'Unknown - Maybe (alt).flac', username: 'u2', size: 1100 },
        ],
      ),
      enqueueResult: vi.fn(async () => ({ id: 'queue-1' })),
      getDownloads: vi.fn(async () => []),
    }

    const orchestrator = createSlskdOrchestrator({
      listPendingJobs: vi.fn(async () => [makeJob({ recommendationId: 44 })]),
      processPendingJobs: vi.fn(async () => {}),
      createSlskdClient: vi.fn(() => slskdClient),
      updateJobState,
      updateRecommendationAction,
      selectBestCandidate: vi.fn(() => ({ decision: 'needs_review', confidence: 0.66 })),
    } as never)

    await orchestrator.triggerSync()

    expect(slskdClient.enqueueResult).not.toHaveBeenCalled()
    expect(updateJobState).toHaveBeenCalledWith(
      1,
      'failed',
      expect.objectContaining({
        confidence: 0.66,
      }),
    )
    expect(updateRecommendationAction).toHaveBeenCalledWith(44, 71, 'needs_review')
  })

  it('queues confident matches and persists search/queue metadata', async () => {
    const updateJobState = vi.fn(async () => makeJob())
    const candidate: SlskdSearchResult = {
      id: 'res-99',
      filename: 'Boards of Canada - Music Has the Right to Children.flac',
      username: 'peer-a',
      size: 1234,
    }
    const slskdClient = {
      createSearch: vi.fn(async () => ({ id: 'search-99' })),
      getSearchResults: vi.fn(async () => [candidate]),
      enqueueResult: vi.fn(async () => ({ id: 'queue-99', downloadId: 'download-99' })),
      getDownloads: vi.fn(async () => []),
    }

    const orchestrator = createSlskdOrchestrator({
      listPendingJobs: vi.fn(async () => [makeJob({ recommendationId: 55 })]),
      processPendingJobs: vi.fn(async () => {}),
      createSlskdClient: vi.fn(() => slskdClient),
      updateJobState,
      updateRecommendationAction: vi.fn(async () => {}),
      selectBestCandidate: vi.fn(() => ({ decision: 'auto_queue', candidate, confidence: 0.98 })),
    } as never)

    await orchestrator.triggerSync()

    expect(updateJobState).toHaveBeenCalledWith(
      1,
      'queued',
      expect.objectContaining({
        slskdSearchId: 'search-99',
        slskdQueueId: 'queue-99',
        slskdDownloadId: 'download-99',
        confidence: 0.98,
        selectedResult: expect.objectContaining({ id: 'res-99' }),
      }),
    )
  })

  it('keeps jobs in searching when slskd search results are not ready yet', async () => {
    const updateJobState = vi.fn(async () => makeJob())
    const slskdClient = {
      createSearch: vi.fn(async () => ({ id: 'search-late' })),
      getSearchResults: vi.fn(async (): Promise<SlskdSearchResult[]> => []),
      enqueueResult: vi.fn(async () => ({ id: 'queue-late' })),
      getDownloads: vi.fn(async () => []),
    }

    const orchestrator = createSlskdOrchestrator({
      listPendingJobs: vi.fn(async () => [makeJob()]),
      processPendingJobs: vi.fn(async () => {}),
      createSlskdClient: vi.fn(() => slskdClient),
      updateJobState,
    } as never)

    await orchestrator.triggerSync()

    expect(updateJobState).toHaveBeenCalledWith(
      1,
      'searching',
      expect.objectContaining({
        slskdSearchId: 'search-late',
      }),
    )
    expect(updateJobState).not.toHaveBeenCalledWith(1, 'failed', expect.anything())
    expect(slskdClient.enqueueResult).not.toHaveBeenCalled()
  })

  it('reconciles queued/downloading jobs from slskd downloads and Lidarr import status', async () => {
    const updateJobState = vi.fn(async () => makeJob())
    const updateRecommendationAction = vi.fn(async () => {})
    const slskdClient = {
      createSearch: vi.fn(async () => ({ id: 'search-not-used' })),
      getSearchResults: vi.fn(async () => []),
      enqueueResult: vi.fn(async () => ({ id: 'queue-not-used' })),
      getDownloads: vi.fn(async () => [
        { id: 'd-1', username: 'u', state: 'InProgress' },
        { id: 'd-2', username: 'u', state: 'Completed' },
      ]),
    }
    const lidarrClient = {
      getWantedMissing: vi.fn(async () => []),
      getAlbums: vi.fn(async () => [
        {
          id: 808,
          title: 'Music Has the Right to Children',
          artistId: 77,
          foreignAlbumId: 'rg-1',
          monitored: true,
          albumType: 'Album',
          statistics: {
            trackCount: 12,
            trackFileCount: 12,
            percentOfTracks: 100,
          },
        },
      ]),
    }
    const listTargets = vi.fn(async () => [
      makeTarget({
        id: 71,
        type: 'slskd',
        config: { url: 'http://slskd.local', apiKey: 'sl-key', lidarrTargetId: 12 },
      }),
      makeTarget({
        id: 12,
        type: 'lidarr',
        config: { url: 'http://lidarr.local', apiKey: 'li-key' },
      }),
    ])

    const orchestrator = createSlskdOrchestrator({
      listPendingJobs: vi.fn(async () => [
        makeJob({
          id: 1,
          recommendationId: 301,
          state: 'queued',
          slskdDownloadId: 'd-1',
        }),
        makeJob({
          id: 2,
          recommendationId: 302,
          state: 'downloading',
          slskdDownloadId: 'd-2',
          lidarrArtistId: 77,
          lidarrAlbumId: 808,
        }),
      ]),
      processPendingJobs: vi.fn(async () => {}),
      listTargets,
      createSlskdClient: vi.fn(() => slskdClient),
      createLidarrClient: vi.fn(() => lidarrClient),
      updateJobState,
      updateRecommendationAction,
    } as never)

    await orchestrator.triggerSync()

    expect(updateJobState).toHaveBeenCalledWith(1, 'downloading', expect.any(Object))
    expect(updateJobState).toHaveBeenCalledWith(2, 'completed', expect.any(Object))
    expect(updateRecommendationAction).toHaveBeenCalledWith(301, 71, 'downloading')
    expect(updateRecommendationAction).toHaveBeenCalledWith(302, 71, 'added')
  })

  it('fails jobs when queued/downloading transfers disappear unexpectedly', async () => {
    const updateJobState = vi.fn(async () => makeJob())
    const orchestrator = createSlskdOrchestrator({
      listPendingJobs: vi.fn(async () => [
        makeJob({
          id: 3,
          state: 'queued',
          slskdDownloadId: 'missing-dl',
        }),
      ]),
      processPendingJobs: vi.fn(async () => {}),
      createSlskdClient: vi.fn(() => ({
        createSearch: vi.fn(async () => ({ id: 'not-used' })),
        getSearchResults: vi.fn(async () => []),
        enqueueResult: vi.fn(async () => ({ id: 'not-used' })),
        getDownloads: vi.fn(async () => [{ id: 'other', username: 'x', state: 'Completed' }]),
      })),
      updateJobState,
    } as never)

    await orchestrator.triggerSync()

    expect(updateJobState).toHaveBeenCalledWith(
      3,
      'failed',
      expect.objectContaining({
        lastError: expect.stringContaining('missing-dl'),
      }),
    )
  })

  it('verifies Lidarr import before failing a missing finished transfer', async () => {
    const updateJobState = vi.fn(async () => makeJob())
    const lidarrClient = {
      getWantedMissing: vi.fn(async () => []),
      getAlbums: vi.fn(async () => [
        {
          id: 808,
          title: 'Music Has the Right to Children',
          artistId: 77,
          foreignAlbumId: 'rg-1',
          monitored: true,
          albumType: 'Album',
          statistics: {
            trackCount: 12,
            trackFileCount: 12,
            percentOfTracks: 100,
          },
        },
      ]),
    }
    const listTargets = vi.fn(async () => [
      makeTarget({
        id: 71,
        type: 'slskd',
        config: { url: 'http://slskd.local', apiKey: 'sl-key', lidarrTargetId: 12 },
      }),
      makeTarget({
        id: 12,
        type: 'lidarr',
        config: { url: 'http://lidarr.local', apiKey: 'li-key' },
      }),
    ])

    const orchestrator = createSlskdOrchestrator({
      listPendingJobs: vi.fn(async () => [
        makeJob({
          id: 4,
          state: 'downloading',
          slskdDownloadId: 'gone',
          lidarrArtistId: 77,
          lidarrAlbumId: 808,
        }),
      ]),
      processPendingJobs: vi.fn(async () => {}),
      listTargets,
      createSlskdClient: vi.fn(() => ({
        createSearch: vi.fn(async () => ({ id: 'not-used' })),
        getSearchResults: vi.fn(async () => []),
        enqueueResult: vi.fn(async () => ({ id: 'not-used' })),
        getDownloads: vi.fn(async () => []),
      })),
      createLidarrClient: vi.fn(() => lidarrClient),
      updateJobState,
    } as never)

    await orchestrator.triggerSync()

    expect(updateJobState).toHaveBeenCalledWith(4, 'completed', expect.any(Object))
    expect(updateJobState).not.toHaveBeenCalledWith(4, 'failed', expect.any(Object))
  })

  it('isolates a throwing job so the rest of the queue still processes', async () => {
    const updateJobState = vi.fn(async () => makeJob())
    // Same targetId -> both jobs share one cached slskd client, so the single
    // createSearch mock rejects for job 1 and resolves for job 2.
    const slskdClient = {
      createSearch: vi
        .fn()
        .mockRejectedValueOnce(new Error('slskd unreachable'))
        .mockResolvedValue({ id: 'search-2' }),
      getSearchResults: vi.fn(async (): Promise<SlskdSearchResult[]> => []),
      enqueueResult: vi.fn(async () => ({ id: 'queue-unused' })),
      getDownloads: vi.fn(async () => []),
    }

    const orchestrator = createSlskdOrchestrator({
      listPendingJobs: vi.fn(async () => [
        makeJob({ id: 1, state: 'pending' }),
        makeJob({ id: 2, state: 'pending' }),
      ]),
      processPendingJobs: vi.fn(async () => {}),
      createSlskdClient: vi.fn(() => slskdClient),
      updateJobState,
    } as never)

    // Must not reject: the first job's error is isolated, not propagated.
    await expect(orchestrator.triggerSync()).resolves.toBeUndefined()

    // Job 1 was marked failed with its error...
    expect(updateJobState).toHaveBeenCalledWith(
      1,
      'failed',
      expect.objectContaining({ lastError: expect.stringContaining('slskd unreachable') }),
    )
    // ...and job 2 was still processed despite job 1 throwing.
    expect(updateJobState).toHaveBeenCalledWith(
      2,
      'searching',
      expect.objectContaining({ slskdSearchId: 'search-2' }),
    )
    expect(slskdClient.createSearch).toHaveBeenCalledTimes(2)
  })
})
