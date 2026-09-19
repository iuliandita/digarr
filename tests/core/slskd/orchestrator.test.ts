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
    config: overrides.config ?? {
      url: 'http://slskd.local',
      apiKey: 'secret',
      lidarrTargetId: 12,
      lidarrDownloadPath: '/downloads',
    },
  }
}

function makeSelectedResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    username: 'peer-a',
    files: [
      {
        filename: 'Boards of Canada\\Music Has the Right to Children\\01 - Wildlife Analysis.flac',
        size: 100,
      },
      {
        filename:
          'Boards of Canada\\Music Has the Right to Children\\02 - An Eagle in Your Mind.flac',
        size: 200,
      },
    ],
    ...overrides,
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

  it.each(['pending', 'downloading', 'import_pending'] as const)(
    'fails stale %s jobs before contacting targets reassigned to another owner',
    async (state) => {
      const createSlskdClient = vi.fn()
      const createLidarrClient = vi.fn()
      const updateJobState = vi.fn()
      const orchestrator = createSlskdOrchestrator({
        listPendingJobs: vi.fn(async () => [makeJob({ state, userId: 1 })]),
        listTargets: vi.fn(async () => [
          makeTarget({ userId: 2 }),
          makeTarget({ id: 12, type: 'lidarr', userId: 2 }),
        ]),
        createSlskdClient,
        createLidarrClient,
        updateJobState,
      } as never)
      const log = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        await orchestrator.triggerSync()
        expect(updateJobState).toHaveBeenCalledWith(1, 'failed', {
          lastError: 'slskd job target is missing or its owner changed',
        })
        expect(createSlskdClient).not.toHaveBeenCalled()
        expect(createLidarrClient).not.toHaveBeenCalled()
      } finally {
        log.mockRestore()
      }
    },
  )

  it('stops ingesting a linked Lidarr wanted queue after its owner changes', async () => {
    const lidarrTarget = makeTarget({ id: 12, type: 'lidarr' })
    const getWantedMissing = vi.fn(async () => [])
    const createLidarrClient = vi.fn(() => ({ getWantedMissing, getAlbums: vi.fn() }))
    const orchestrator = createSlskdOrchestrator({
      listPendingJobs: vi.fn(async () => []),
      processPendingJobs: vi.fn(async () => {}),
      listTargets: vi.fn(async () => [makeTarget(), lidarrTarget]),
      createLidarrClient,
      findActiveJobByWorkKey: vi.fn(),
      createJob: vi.fn(),
    } as never)
    await orchestrator.triggerSync()
    expect(getWantedMissing).toHaveBeenCalledTimes(1)
    lidarrTarget.userId = 2
    createLidarrClient.mockClear()
    getWantedMissing.mockClear()
    await orchestrator.triggerSync()
    expect(createLidarrClient).not.toHaveBeenCalled()
    expect(getWantedMissing).not.toHaveBeenCalled()
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

  it('fails empty-query jobs without calling slskd', async () => {
    const updateJobState = vi.fn(async () => makeJob())
    const slskdClient = {
      createSearch: vi.fn(async () => ({ id: 'must-not-run' })),
      getSearchResults: vi.fn(async (): Promise<SlskdSearchResult[]> => []),
      enqueueResult: vi.fn(async () => ({ id: 'must-not-run' })),
      getDownloads: vi.fn(async () => []),
    }
    const orchestrator = createSlskdOrchestrator({
      listPendingJobs: vi.fn(async () => [makeJob({ id: 8, artistName: ' ', releaseTitle: '\t' })]),
      processPendingJobs: vi.fn(async () => {}),
      createSlskdClient: vi.fn(() => slskdClient),
      updateJobState,
    } as never)

    await orchestrator.triggerSync()

    expect(slskdClient.createSearch).not.toHaveBeenCalled()
    expect(slskdClient.getSearchResults).not.toHaveBeenCalled()
    expect(slskdClient.enqueueResult).not.toHaveBeenCalled()
    expect(updateJobState).toHaveBeenCalledWith(8, 'failed', {
      lastError: 'slskd job requires an artist name or release title',
    })
  })

  it.each([
    { artistName: 'Burial', releaseTitle: '   ', expectedQuery: 'Burial' },
    { artistName: '   ', releaseTitle: 'Untrue', expectedQuery: 'Untrue' },
  ])(
    'searches when one query field is present',
    async ({ artistName, releaseTitle, expectedQuery }) => {
      const slskdClient = {
        createSearch: vi.fn(async () => ({ id: 'search-partial' })),
        getSearchResults: vi.fn(async (): Promise<SlskdSearchResult[]> => []),
        enqueueResult: vi.fn(async () => ({ id: 'must-not-run' })),
        getDownloads: vi.fn(async () => []),
      }
      const orchestrator = createSlskdOrchestrator({
        listPendingJobs: vi.fn(async () => [makeJob({ artistName, releaseTitle })]),
        processPendingJobs: vi.fn(async () => {}),
        createSlskdClient: vi.fn(() => slskdClient),
        updateJobState: vi.fn(async () => makeJob()),
      } as never)

      await orchestrator.triggerSync()

      expect(slskdClient.createSearch).toHaveBeenCalledWith(expectedQuery)
    },
  )

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
      filename: 'Boards of Canada - Music Has the Right to Children',
      username: 'peer-a',
      directory: 'Boards of Canada\\Music Has the Right to Children',
      directories: ['Boards of Canada\\Music Has the Right to Children'],
      files: [
        {
          filename: 'Boards of Canada\\Music Has the Right to Children\\01.flac',
          size: 1234,
        },
      ],
      size: 1234,
    }
    const slskdClient = {
      createSearch: vi.fn(async () => ({ id: 'search-99' })),
      getSearchResults: vi.fn(async () => [candidate]),
      enqueueResult: vi.fn(async () => ({
        batch: {
          id: 'queue-99',
        },
        failures: [],
      })),
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

    expect(updateJobState).toHaveBeenNthCalledWith(1, 1, 'searching', {
      attempts: 1,
      lastError: null,
    })
    expect(updateJobState).toHaveBeenCalledWith(
      1,
      'queued',
      expect.objectContaining({
        slskdSearchId: 'search-99',
        slskdQueueId: 'queue-99',
        confidence: 0.98,
        selectedResult: {
          username: 'peer-a',
          files: candidate.files,
        },
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

  it('waits until every expected slskd file succeeds', async () => {
    const updateJobState = vi.fn(async () => makeJob())
    const getDownloads = vi.fn(async () => [
      {
        username: 'peer-a',
        directories: [
          {
            directory: 'Boards of Canada\\Music Has the Right to Children',
            fileCount: 1,
            files: [
              {
                id: 'd-1',
                username: 'peer-a',
                filename:
                  'Boards of Canada\\Music Has the Right to Children\\01 - Wildlife Analysis.flac',
                size: 100,
                state: 'Completed, Succeeded',
              },
            ],
          },
        ],
      },
    ])
    const orchestrator = createSlskdOrchestrator({
      listPendingJobs: vi.fn(async () => [
        makeJob({ state: 'downloading', selectedResult: makeSelectedResult() }),
      ]),
      createSlskdClient: vi.fn(() => ({
        createSearch: vi.fn(),
        getSearchResults: vi.fn(),
        enqueueResult: vi.fn(),
        getDownloads,
      })),
      updateJobState,
    } as never)

    await orchestrator.triggerSync()

    expect(updateJobState).toHaveBeenCalledWith(1, 'downloading', expect.any(Object))
    expect(updateJobState).not.toHaveBeenCalledWith(1, 'completed', expect.anything())
  })

  it('fails legacy single-file selections without a complete manifest', async () => {
    const updateJobState = vi.fn(async () => makeJob())
    const getDownloads = vi.fn()
    const orchestrator = createSlskdOrchestrator({
      listPendingJobs: vi.fn(async () => [
        makeJob({
          state: 'downloading',
          selectedResult: {
            id: 'legacy-result',
            filename: 'Artist\\Album\\01.flac',
            username: 'peer-a',
            size: 100,
          },
        }),
      ]),
      createSlskdClient: vi.fn(() => ({ getDownloads })),
      updateJobState,
    } as never)

    await orchestrator.triggerSync()

    expect(updateJobState).toHaveBeenCalledWith(1, 'failed', {
      lastError: 'slskd job is missing its selected release manifest',
    })
    expect(getDownloads).not.toHaveBeenCalled()
  })

  it('does not match a completed transfer from a different batch', async () => {
    const updateJobState = vi.fn(async () => makeJob())
    const selectedResult = makeSelectedResult({
      files: [
        {
          filename:
            'Boards of Canada\\Music Has the Right to Children\\01 - Wildlife Analysis.flac',
          size: 100,
        },
      ],
    })
    const orchestrator = createSlskdOrchestrator({
      listPendingJobs: vi.fn(async () => [
        makeJob({ state: 'downloading', slskdQueueId: 'batch-new', selectedResult }),
      ]),
      createSlskdClient: vi.fn(() => ({
        getDownloads: vi.fn(async () => [
          {
            username: 'peer-a',
            directories: [
              {
                files: [
                  {
                    id: 'old-transfer',
                    batchId: 'batch-old',
                    username: 'peer-a',
                    filename:
                      'Boards of Canada\\Music Has the Right to Children\\01 - Wildlife Analysis.flac',
                    size: 100,
                    state: 'Completed, Succeeded',
                  },
                ],
              },
            ],
          },
        ]),
      })),
      updateJobState,
    } as never)

    await orchestrator.triggerSync()

    expect(updateJobState).toHaveBeenCalledWith(1, 'queued', expect.any(Object))
    expect(updateJobState).not.toHaveBeenCalledWith(1, 'completed', expect.anything())
  })

  it.each(['Completed, Rejected', 'Completed, Errored'])(
    'reports a terminal slskd file state: %s',
    async (state) => {
      const updateJobState = vi.fn(async () => makeJob())
      const selectedResult = makeSelectedResult({
        files: [
          {
            filename:
              'Boards of Canada\\Music Has the Right to Children\\01 - Wildlife Analysis.flac',
            size: 100,
          },
        ],
      })
      const orchestrator = createSlskdOrchestrator({
        listPendingJobs: vi.fn(async () => [makeJob({ state: 'downloading', selectedResult })]),
        createSlskdClient: vi.fn(() => ({
          createSearch: vi.fn(),
          getSearchResults: vi.fn(),
          enqueueResult: vi.fn(),
          getDownloads: vi.fn(async () => [
            {
              username: 'peer-a',
              directories: [
                {
                  directory: 'Boards of Canada\\Music Has the Right to Children',
                  fileCount: 1,
                  files: [
                    {
                      id: 'd-1',
                      username: 'peer-a',
                      filename:
                        'Boards of Canada\\Music Has the Right to Children\\01 - Wildlife Analysis.flac',
                      size: 100,
                      state,
                    },
                  ],
                },
              ],
            },
          ]),
        })),
        updateJobState,
      } as never)

      await orchestrator.triggerSync()

      expect(updateJobState).toHaveBeenCalledWith(
        1,
        'failed',
        expect.objectContaining({ lastError: expect.stringContaining(state) }),
      )
    },
  )

  it('submits a guarded multi-file Lidarr ManualImport after every transfer succeeds', async () => {
    const updateJobState = vi.fn(async () => makeJob())
    const manualImport = vi.fn(async () => ({ id: 991, name: 'ManualImport', status: 'queued' }))
    const selectedResult = makeSelectedResult()
    const transfers = (selectedResult.files as Array<{ filename: string; size: number }>).map(
      (file, index) => ({
        id: `d-${index}`,
        username: 'peer-a',
        filename: file.filename,
        size: file.size,
        state: 'Completed, Succeeded',
      }),
    )
    const lidarrClient = {
      getWantedMissing: vi.fn(async () => []),
      getManualImport: vi.fn(async () => [
        {
          path: '/downloads/Music Has the Right to Children/01 - Wildlife Analysis.flac',
          artist: { id: 77 },
          album: { id: 808 },
          tracks: [{ id: 1001 }],
          quality: { quality: { id: 7, name: 'FLAC' } },
          rejections: [],
        },
        {
          path: '/downloads/Music Has the Right to Children/02 - An Eagle in Your Mind.flac',
          artist: { id: 77 },
          album: { id: 808 },
          tracks: [{ id: 1002 }],
          quality: { quality: { id: 7, name: 'FLAC' } },
          rejections: [],
        },
      ]),
      getTracks: vi.fn(async () => [
        { id: 1001, albumId: 808, hasFile: false },
        { id: 1002, albumId: 808, hasFile: false },
      ]),
      manualImport,
    }
    const orchestrator = createSlskdOrchestrator({
      listPendingJobs: vi.fn(async () => [
        makeJob({
          state: 'downloading',
          recommendationId: 301,
          selectedResult,
          lidarrArtistId: 77,
          lidarrAlbumId: 808,
        }),
      ]),
      listTargets: vi.fn(async () => [
        makeTarget(),
        makeTarget({
          id: 12,
          type: 'lidarr',
          config: { url: 'http://lidarr.local', apiKey: 'li-key' },
        }),
      ]),
      createSlskdClient: vi.fn(() => ({
        createSearch: vi.fn(),
        getSearchResults: vi.fn(),
        enqueueResult: vi.fn(),
        getDownloads: vi.fn(async () => [
          {
            username: 'peer-a',
            directories: [
              {
                directory: 'Boards of Canada\\Music Has the Right to Children',
                fileCount: 2,
                files: transfers,
              },
            ],
          },
        ]),
      })),
      createLidarrClient: vi.fn(() => lidarrClient),
      updateJobState,
    } as never)

    await orchestrator.triggerSync()

    expect(manualImport).toHaveBeenCalledWith([
      expect.objectContaining({ artistId: 77, albumId: 808, trackIds: [1001] }),
      expect.objectContaining({ artistId: 77, albumId: 808, trackIds: [1002] }),
    ])
    expect(updateJobState).toHaveBeenCalledWith(
      1,
      'import_pending',
      expect.objectContaining({
        selectedResult: expect.objectContaining({
          import: {
            commandId: 991,
            albumId: 808,
            expectedTrackIds: [1001, 1002],
            checks: 0,
          },
        }),
      }),
    )
  })

  it('does not resubmit ManualImport and only completes after every expected track hasFile', async () => {
    const updateJobState = vi.fn(async () => makeJob())
    const manualImport = vi.fn()
    const orchestrator = createSlskdOrchestrator({
      listPendingJobs: vi.fn(async () => [
        makeJob({
          state: 'import_pending',
          lidarrArtistId: 77,
          lidarrAlbumId: 808,
          selectedResult: makeSelectedResult({
            import: {
              commandId: 991,
              albumId: 808,
              expectedTrackIds: [1001, 1002],
              checks: 0,
            },
          }),
        }),
      ]),
      listTargets: vi.fn(async () => [makeTarget(), makeTarget({ id: 12, type: 'lidarr' })]),
      createSlskdClient: vi.fn(() => ({
        createSearch: vi.fn(),
        getSearchResults: vi.fn(),
        enqueueResult: vi.fn(),
        getDownloads: vi.fn(),
      })),
      createLidarrClient: vi.fn(() => ({
        getCommand: vi.fn(async () => ({ id: 991, name: 'ManualImport', status: 'completed' })),
        getTracks: vi.fn(async () => [
          { id: 1001, hasFile: true },
          { id: 1002, hasFile: true },
        ]),
        manualImport,
      })),
      updateJobState,
    } as never)

    await orchestrator.triggerSync()

    expect(manualImport).not.toHaveBeenCalled()
    expect(updateJobState).toHaveBeenCalledWith(1, 'completed', { lastError: null })
  })

  it('fails an in-flight import when its Lidarr link is removed', async () => {
    const updateJobState = vi.fn()
    const getDownloads = vi.fn()
    const orchestrator = createSlskdOrchestrator({
      listPendingJobs: vi.fn(async () => [
        makeJob({
          state: 'import_pending',
          lidarrArtistId: 77,
          selectedResult: makeSelectedResult({
            import: {
              commandId: 991,
              albumId: 808,
              expectedTrackIds: [1001, 1002],
              checks: 0,
            },
          }),
        }),
      ]),
      listTargets: vi.fn(async () => [
        makeTarget({ config: { url: 'http://slskd.local', apiKey: 'secret' } }),
      ]),
      createSlskdClient: vi.fn(() => ({ getDownloads })),
      updateJobState,
    } as never)
    await orchestrator.triggerSync()
    expect(updateJobState).toHaveBeenCalledWith(1, 'failed', {
      lastError: 'Lidarr import cannot be verified: its checkpoint or linked target is missing',
    })
    expect(getDownloads).not.toHaveBeenCalled()
    expect(updateJobState).not.toHaveBeenCalledWith(1, 'completed', expect.anything())
  })

  it('does not treat a linked download as standalone when its link is removed', async () => {
    const selected = makeSelectedResult()
    const updateJobState = vi.fn()
    const orchestrator = createSlskdOrchestrator({
      listPendingJobs: vi.fn(async () => [
        makeJob({
          state: 'downloading',
          lidarrArtistId: 77,
          selectedResult: selected,
        }),
      ]),
      listTargets: vi.fn(async () => [
        makeTarget({ config: { url: 'http://slskd.local', apiKey: 'secret' } }),
      ]),
      createSlskdClient: vi.fn(() => ({
        getDownloads: vi.fn(async () => [
          {
            username: selected.username,
            directories: [
              {
                files: selected.files.map((file, index) => ({
                  ...file,
                  id: String(index),
                  state: 'Completed, Succeeded',
                })),
              },
            ],
          },
        ]),
      })),
      updateJobState,
    } as never)
    await orchestrator.triggerSync()
    expect(updateJobState).toHaveBeenCalledWith(1, 'failed', {
      lastError: 'Lidarr import cannot proceed: its linked target is missing',
    })
    expect(updateJobState).not.toHaveBeenCalledWith(1, 'completed', expect.anything())
  })

  it('keeps a completed command pending while any expected Lidarr track lacks a file', async () => {
    const updateJobState = vi.fn(async () => makeJob())
    const orchestrator = createSlskdOrchestrator({
      listPendingJobs: vi.fn(async () => [
        makeJob({
          state: 'import_pending',
          lidarrArtistId: 77,
          lidarrAlbumId: 808,
          selectedResult: makeSelectedResult({
            import: {
              commandId: 991,
              albumId: 808,
              expectedTrackIds: [1001, 1002],
              checks: 0,
            },
          }),
        }),
      ]),
      listTargets: vi.fn(async () => [makeTarget(), makeTarget({ id: 12, type: 'lidarr' })]),
      createSlskdClient: vi.fn(() => ({
        createSearch: vi.fn(),
        getSearchResults: vi.fn(),
        enqueueResult: vi.fn(),
        getDownloads: vi.fn(),
      })),
      createLidarrClient: vi.fn(() => ({
        getCommand: vi.fn(async () => ({ id: 991, name: 'ManualImport', status: 'completed' })),
        getTracks: vi.fn(async () => [
          { id: 1001, hasFile: true },
          { id: 1002, hasFile: false },
        ]),
      })),
      updateJobState,
    } as never)

    await orchestrator.triggerSync()

    expect(updateJobState).toHaveBeenCalledWith(
      1,
      'import_pending',
      expect.objectContaining({
        selectedResult: expect.objectContaining({ import: expect.objectContaining({ checks: 1 }) }),
      }),
    )
    expect(updateJobState).not.toHaveBeenCalledWith(1, 'completed', expect.anything())
  })

  it('bounds import polling instead of waiting forever', async () => {
    const updateJobState = vi.fn(async () => makeJob())
    const orchestrator = createSlskdOrchestrator({
      listPendingJobs: vi.fn(async () => [
        makeJob({
          state: 'import_pending',
          lidarrArtistId: 77,
          selectedResult: makeSelectedResult({
            import: {
              commandId: 991,
              albumId: 808,
              expectedTrackIds: [1001],
              checks: 11,
            },
          }),
        }),
      ]),
      listTargets: vi.fn(async () => [makeTarget(), makeTarget({ id: 12, type: 'lidarr' })]),
      createSlskdClient: vi.fn(() => ({
        createSearch: vi.fn(),
        getSearchResults: vi.fn(),
        enqueueResult: vi.fn(),
        getDownloads: vi.fn(),
      })),
      createLidarrClient: vi.fn(() => ({
        getCommand: vi.fn(async () => ({ id: 991, name: 'ManualImport', status: 'started' })),
        getTracks: vi.fn(),
      })),
      updateJobState,
    } as never)

    await orchestrator.triggerSync()

    expect(updateJobState).toHaveBeenCalledWith(
      1,
      'failed',
      expect.objectContaining({ lastError: expect.stringContaining('did not import every') }),
    )
  })

  it('reports already-present tracks as skipped without submitting a destructive import', async () => {
    const updateJobState = vi.fn(async () => makeJob())
    const updateRecommendationAction = vi.fn(async () => {})
    const manualImport = vi.fn()
    const selectedResult = makeSelectedResult({
      files: [
        {
          filename:
            'Boards of Canada\\Music Has the Right to Children\\01 - Wildlife Analysis.flac',
          size: 100,
        },
      ],
    })
    const remoteFile = (selectedResult.files as Array<{ filename: string; size: number }>)[0]
    if (!remoteFile) throw new Error('test release file missing')
    const orchestrator = createSlskdOrchestrator({
      listPendingJobs: vi.fn(async () => [
        makeJob({
          state: 'downloading',
          recommendationId: 301,
          selectedResult,
          lidarrArtistId: 77,
          lidarrAlbumId: 808,
        }),
      ]),
      listTargets: vi.fn(async () => [makeTarget(), makeTarget({ id: 12, type: 'lidarr' })]),
      createSlskdClient: vi.fn(() => ({
        createSearch: vi.fn(),
        getSearchResults: vi.fn(),
        enqueueResult: vi.fn(),
        getDownloads: vi.fn(async () => [
          {
            username: 'peer-a',
            directories: [
              {
                directory: 'Boards of Canada\\Music Has the Right to Children',
                fileCount: 1,
                files: [
                  {
                    id: 'd-1',
                    username: 'peer-a',
                    filename: remoteFile.filename,
                    size: remoteFile.size,
                    state: 'Completed, Succeeded',
                  },
                ],
              },
            ],
          },
        ]),
      })),
      createLidarrClient: vi.fn(() => ({
        getManualImport: vi.fn(async () => [
          {
            path: '/downloads/Music Has the Right to Children/01 - Wildlife Analysis.flac',
            artist: { id: 77 },
            album: { id: 808 },
            tracks: [{ id: 1001 }],
            quality: { quality: { id: 7, name: 'FLAC' } },
            rejections: [],
          },
        ]),
        getTracks: vi.fn(async () => [{ id: 1001, hasFile: true }]),
        manualImport,
      })),
      updateJobState,
      updateRecommendationAction,
    } as never)

    await orchestrator.triggerSync()

    expect(manualImport).not.toHaveBeenCalled()
    expect(updateJobState).toHaveBeenCalledWith(
      1,
      'cancelled',
      expect.objectContaining({ lastError: expect.stringContaining('left untouched') }),
    )
    expect(updateRecommendationAction).toHaveBeenCalledWith(
      301,
      71,
      'skipped',
      expect.stringContaining('left untouched'),
    )
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
