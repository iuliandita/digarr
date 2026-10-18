// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { type AutoApproveDeps, autoApprove } from '@/core/pipeline/auto-approve'
import { PipelineCancelledError } from '@/core/pipeline/cancel'

function makeDeps(overrides: Partial<AutoApproveDeps> = {}): AutoApproveDeps {
  return {
    getRecommendationsByBatch: vi.fn().mockResolvedValue([
      {
        id: 1,
        score: 0.9,
        status: 'pending',
        kind: 'artist',
        recommendedReleaseGroupId: null,
        artist: { mbid: 'mbid-1', name: 'Artist A' },
      },
      {
        id: 2,
        score: 0.6,
        status: 'pending',
        kind: 'artist',
        recommendedReleaseGroupId: null,
        artist: { mbid: 'mbid-2', name: 'Artist B' },
      },
      {
        id: 3,
        score: 0.4,
        status: 'pending',
        kind: 'artist',
        recommendedReleaseGroupId: null,
        artist: { mbid: 'mbid-3', name: 'Artist C' },
      },
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
  it.each(['missing', 'existing', 'latest', 'first'] as const)(
    'passes %s to the target',
    async (monitorOption) => {
      const deps = makeDeps()
      await autoApprove(1, { threshold: 0.7, monitorOption }, deps)
      const [target] = await deps.getEnabledTargets()
      expect(target?.addArtist).toHaveBeenCalledWith(
        { mbid: 'mbid-1', name: 'Artist A' },
        expect.objectContaining({ monitorOption }),
      )
    },
  )

  it('approves recommendations above threshold via targets', async () => {
    const deps = makeDeps()
    const result = await autoApprove(
      1,
      {
        threshold: 0.7,
        monitorOption: 'all',
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
      expect.objectContaining({ monitorOption: 'all' }),
    )
  })

  it('skips non-pending recommendations', async () => {
    const deps = makeDeps({
      getRecommendationsByBatch: vi.fn().mockResolvedValue([
        {
          id: 1,
          score: 0.9,
          status: 'rejected',
          kind: 'artist',
          recommendedReleaseGroupId: null,
          artist: { mbid: 'mbid-1', name: 'A' },
        },
      ]),
    })
    const result = await autoApprove(
      1,
      {
        threshold: 0.5,
        monitorOption: 'all',
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
        {
          id: 1,
          score: 0.9,
          status: 'pending',
          kind: 'artist',
          recommendedReleaseGroupId: null,
          artist: { mbid: 'mbid-1', name: 'A' },
        },
        {
          id: 2,
          score: 0.8,
          status: 'pending',
          kind: 'artist',
          recommendedReleaseGroupId: null,
          artist: { mbid: 'mbid-2', name: 'B' },
        },
      ]),
    })
    const result = await autoApprove(
      1,
      {
        threshold: 0.5,
        monitorOption: 'all',
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
            error: 'HTTP 400: invalid profile',
          }),
          testConnection: vi.fn(),
        },
      ]),
      getRecommendationsByBatch: vi.fn().mockResolvedValue([
        {
          id: 1,
          score: 0.9,
          status: 'pending',
          kind: 'artist',
          recommendedReleaseGroupId: null,
          artist: { mbid: 'mbid-1', name: 'A' },
        },
      ]),
    })
    const result = await autoApprove(
      1,
      {
        threshold: 0.5,
        monitorOption: 'all',
      },
      deps,
    )
    expect(result.approved).toBe(0)
    expect(result.failed).toBe(1)
    expect(deps.updateRecommendationStatus).toHaveBeenCalledWith(
      1,
      'add_failed',
      expect.objectContaining({ lidarrError: 'HTTP 400: invalid profile' }),
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
      getRecommendationsByBatch: vi.fn().mockResolvedValue([
        {
          id: 1,
          score: 0.9,
          status: 'pending',
          kind: 'artist',
          recommendedReleaseGroupId: null,
          artist: { mbid: 'mbid-1', name: 'A' },
        },
      ]),
    })
    await autoApprove(
      1,
      {
        threshold: 0.5,
        monitorOption: 'all',
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
      getRecommendationsByBatch: vi.fn().mockResolvedValue([
        {
          id: 1,
          score: 0.9,
          status: 'pending',
          kind: 'artist',
          recommendedReleaseGroupId: null,
          artist: { mbid: 'mbid-1', name: 'A' },
        },
      ]),
    })
    const result = await autoApprove(
      1,
      {
        threshold: 0.5,
        monitorOption: 'all',
      },
      deps,
    )
    expect(result.approved).toBe(1)
    expect(deps.updateRecommendationStatus).toHaveBeenCalledWith(1, 'approved', expect.any(Object))
  })

  const config = {
    threshold: 0.7,
    monitorOption: 'new' as const,
  }
  const albumRec = {
    id: 11,
    score: 0.9,
    status: 'pending',
    kind: 'album',
    recommendedReleaseGroupId: 'release-1',
    artist: { mbid: 'mbid-1', name: 'Artist A' },
  }

  it('dispatches mixed recommendations by kind and preserves acquisition context', async () => {
    const addArtist = vi.fn().mockResolvedValue({ success: true, externalId: 99 })
    const addAlbum = vi.fn().mockResolvedValue({ success: true, externalId: 123 })
    const recorder = {
      start: vi.fn().mockResolvedValue(1),
      complete: vi.fn(),
      fail: vi.fn(),
      cancel: vi.fn(),
      markStuck: vi.fn(),
    }
    const deps = makeDeps({
      userId: 7,
      jobRecorder: recorder,
      getRecommendationsByBatch: vi
        .fn()
        .mockResolvedValue([
          { ...albumRec, id: 10, kind: 'artist', recommendedReleaseGroupId: null },
          albumRec,
        ]),
      getEnabledTargets: vi.fn().mockResolvedValue([
        {
          id: 'lidarr-1',
          type: 'lidarr',
          capabilities: ['addArtist', 'addAlbum'],
          addArtist,
          addAlbum,
        },
      ]),
    })
    expect(await autoApprove(1, config, deps)).toEqual({ approved: 2, failed: 0 })
    expect(addArtist).toHaveBeenCalledExactlyOnceWith(
      { mbid: 'mbid-1', name: 'Artist A' },
      {
        monitorOption: 'new',
        userId: 7,
        recommendationId: 10,
      },
    )
    expect(addAlbum).toHaveBeenCalledExactlyOnceWith(
      { artistMbid: 'mbid-1', artistName: 'Artist A', releaseGroupMbid: 'release-1' },
      expect.objectContaining({
        monitorOption: 'new',
        userId: 7,
        recommendationId: 11,
      }),
    )
    expect(deps.updateRecommendationStatus).toHaveBeenCalledWith(10, 'added_to_lidarr', {
      targetActions: { 'lidarr-1': { status: 'added', externalId: 99, error: undefined } },
      lidarrArtistId: 99,
    })
    expect(deps.updateRecommendationStatus).toHaveBeenCalledWith(11, 'added_to_lidarr', {
      targetActions: { 'lidarr-1': { status: 'added', externalId: 123, error: undefined } },
    })
    expect(recorder.start).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ action: 'addAlbum', releaseGroupMbid: 'release-1' }),
      }),
    )
  })

  it.each(['missing release', 'artist-only target', 'unimplemented album capability'])(
    'fails closed for %s without artist acquisition or prewarming',
    async (scenario) => {
      const addArtist = vi.fn()
      const addAlbum = vi.fn()
      const deps = makeDeps({
        getRecommendationsByBatch: vi.fn().mockResolvedValue([
          {
            ...albumRec,
            recommendedReleaseGroupId: scenario === 'missing release' ? null : 'release-1',
          },
        ]),
        getEnabledTargets: vi.fn().mockResolvedValue([
          {
            id: 'lidarr-1',
            type: 'lidarr',
            addArtist,
            capabilities:
              scenario === 'artist-only target' ? ['addArtist'] : ['addArtist', 'addAlbum'],
            ...(scenario === 'missing release' ? { addAlbum } : {}),
          },
        ]),
      })
      expect(await autoApprove(1, config, deps)).toEqual({ approved: 0, failed: 1 })
      expect(addArtist).not.toHaveBeenCalled()
      expect(addAlbum).not.toHaveBeenCalled()
      expect(deps.warmArtist).not.toHaveBeenCalled()
      expect(deps.updateRecommendationStatus).toHaveBeenCalledWith(11, 'add_failed', {
        targetActions: {},
      })
    },
  )

  it.each(['lidarr', 'slskd'])(
    'acquires albums through an explicit %s album-only target',
    async (type) => {
      const addAlbum = vi.fn().mockResolvedValue({ success: true, externalId: 123 })
      const deps = makeDeps({
        getRecommendationsByBatch: vi.fn().mockResolvedValue([albumRec]),
        getEnabledTargets: vi
          .fn()
          .mockResolvedValue([{ id: 'album-target', type, capabilities: ['addAlbum'], addAlbum }]),
      })
      expect(await autoApprove(1, config, deps)).toEqual({ approved: 1, failed: 0 })
      expect(addAlbum).toHaveBeenCalledTimes(1)
      expect(deps.updateRecommendationStatus).toHaveBeenCalledWith(
        11,
        type === 'lidarr' ? 'added_to_lidarr' : 'approved',
        {
          targetActions: {
            'album-target': {
              status: type === 'slskd' ? 'queued' : 'added',
              externalId: 123,
              error: undefined,
            },
          },
        },
      )
      expect(deps.warmArtist).toHaveBeenCalledTimes(type === 'lidarr' ? 1 : 0)
    },
  )

  it('preserves discovery-only album approval and pending/score filtering', async () => {
    const deps = makeDeps({
      getRecommendationsByBatch: vi
        .fn()
        .mockResolvedValue([
          albumRec,
          { ...albumRec, id: 12, score: 0.6 },
          { ...albumRec, id: 13, status: 'approved' },
        ]),
      getEnabledTargets: vi
        .fn()
        .mockResolvedValue([
          { id: 'playlist', type: 'spotify-playlist', capabilities: ['createPlaylist'] },
        ]),
    })
    expect(await autoApprove(1, config, deps)).toEqual({ approved: 1, failed: 0 })
    expect(deps.updateRecommendationStatus).toHaveBeenCalledExactlyOnceWith(11, 'approved', {
      targetActions: {},
    })
    expect(deps.warmArtist).not.toHaveBeenCalled()
  })

  it('preserves Lidarr album failure details', async () => {
    const deps = makeDeps({
      getRecommendationsByBatch: vi.fn().mockResolvedValue([albumRec]),
      getEnabledTargets: vi.fn().mockResolvedValue([
        {
          id: 'lidarr-1',
          type: 'lidarr',
          capabilities: ['addAlbum'],
          addAlbum: vi
            .fn()
            .mockResolvedValue({ success: false, externalId: 123, error: 'album missing' }),
        },
      ]),
    })
    expect(await autoApprove(1, config, deps)).toEqual({ approved: 0, failed: 1 })
    expect(deps.updateRecommendationStatus).toHaveBeenCalledWith(11, 'add_failed', {
      targetActions: { 'lidarr-1': { status: 'failed', externalId: 123, error: 'album missing' } },
      lidarrError: 'album missing',
    })
  })
  it.each(['artist-success', 'artist-failure', 'album-success'])(
    'drains and persists an attempted %s before stopping',
    async (scenario) => {
      const controller = new AbortController()
      const album = scenario.startsWith('album')
      const success = !scenario.endsWith('failure')
      let release!: () => void
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      let entered!: () => void
      const started = new Promise<void>((resolve) => {
        entered = resolve
      })
      const add = vi.fn(async () => {
        entered()
        await held
        return {
          success,
          targetType: 'lidarr',
          targetId: 1,
          externalId: 99,
          error: success ? undefined : 'target failed',
        }
      })
      const second = vi.fn()
      const deps = makeDeps({
        getRecommendationsByBatch: vi.fn().mockResolvedValue(
          [1, 2].map((id) => ({
            id,
            score: 1,
            status: 'pending',
            kind: album ? 'album' : 'artist',
            recommendedReleaseGroupId: album ? 'rg' : null,
            artist: { mbid: `mbid-${id}`, name: 'A' },
          })),
        ),
        getEnabledTargets: vi.fn().mockResolvedValue([
          {
            id: 'first',
            type: 'lidarr',
            capabilities: [album ? 'addAlbum' : 'addArtist'],
            addArtist: add,
            addAlbum: add,
          },
          {
            id: 'second',
            type: 'lidarr',
            capabilities: [album ? 'addAlbum' : 'addArtist'],
            addArtist: second,
            addAlbum: second,
          },
        ]),
        jobRecorder: {
          start: vi.fn().mockResolvedValue(11),
          complete: vi.fn(),
          fail: vi.fn(),
          cancel: vi.fn(),
          markStuck: vi.fn(),
        },
      })
      const run = autoApprove(1, { threshold: 0.5, monitorOption: 'all' }, deps, controller.signal)
      const rejected = expect(run).rejects.toThrow(
        success ? PipelineCancelledError : 'target failed',
      )
      await started
      controller.abort()
      expect(deps.updateRecommendationStatus).not.toHaveBeenCalled()
      release()
      await rejected
      expect(add).toHaveBeenCalledOnce()
      expect(second).not.toHaveBeenCalled()
      expect(deps.updateRecommendationStatus).toHaveBeenCalledExactlyOnceWith(
        1,
        success ? 'added_to_lidarr' : 'add_failed',
        expect.objectContaining({
          targetActions: {
            first: expect.objectContaining({ status: success ? 'added' : 'failed' }),
          },
        }),
      )
      expect(success ? deps.jobRecorder?.complete : deps.jobRecorder?.fail).toHaveBeenCalledOnce()
    },
  )

  it('cancels a started target job without invoking its target when job creation drains', async () => {
    const controller = new AbortController()
    const deps = makeDeps({
      jobRecorder: {
        start: vi.fn(async () => {
          controller.abort()
          return 11
        }),
        cancel: vi.fn(),
        complete: vi.fn(),
        fail: vi.fn(),
        markStuck: vi.fn(),
      },
    })
    const targets = await deps.getEnabledTargets()
    await expect(
      autoApprove(1, { threshold: 0.5, monitorOption: 'all' }, deps, controller.signal),
    ).rejects.toBeInstanceOf(PipelineCancelledError)
    expect(deps.jobRecorder?.cancel).toHaveBeenCalledWith(11)
    expect(targets[0]?.addArtist).not.toHaveBeenCalled()
    expect(deps.updateRecommendationStatus).not.toHaveBeenCalled()
  })

  it.each(['zero-target', 'invalid-album'])(
    'drains a begun %s status write before stopping',
    async (scenario) => {
      const controller = new AbortController()
      const deps = makeDeps({
        getEnabledTargets: vi.fn().mockResolvedValue([]),
        getRecommendationsByBatch: vi.fn().mockResolvedValue(
          [1, 2].map((id) => ({
            id,
            score: 1,
            status: 'pending',
            kind: scenario === 'invalid-album' ? 'album' : 'artist',
            recommendedReleaseGroupId: null,
            artist: { mbid: 'a', name: 'A' },
          })),
        ),
        updateRecommendationStatus: vi.fn(async () => {
          controller.abort()
        }),
      })
      await expect(
        autoApprove(1, { threshold: 0.5, monitorOption: 'all' }, deps, controller.signal),
      ).rejects.toBeInstanceOf(PipelineCancelledError)
      expect(deps.updateRecommendationStatus).toHaveBeenCalledOnce()
    },
  )
  it('stops after warming without attempting a target or changing recommendation status', async () => {
    const controller = new AbortController()
    const deps = makeDeps({
      warmArtist: vi.fn(async () => {
        controller.abort()
      }),
    })
    const targets = await deps.getEnabledTargets()
    await expect(
      autoApprove(1, { threshold: 0.5, monitorOption: 'all' }, deps, controller.signal),
    ).rejects.toBeInstanceOf(PipelineCancelledError)
    expect(targets[0]?.addArtist).not.toHaveBeenCalled()
    expect(deps.updateRecommendationStatus).not.toHaveBeenCalled()
  })

  it('preserves an actual target exception and its action when cancellation arrives during the call', async () => {
    const controller = new AbortController()
    const failure = new Error('remote write failed')
    const deps = makeDeps()
    const targets = await deps.getEnabledTargets()
    const add = vi.mocked(
      targets[0]?.addArtist as NonNullable<(typeof targets)[number]['addArtist']>,
    )
    add.mockImplementationOnce(async () => {
      controller.abort()
      throw failure
    })
    await expect(
      autoApprove(1, { threshold: 0.5, monitorOption: 'all' }, deps, controller.signal),
    ).rejects.toBe(failure)
    expect(deps.updateRecommendationStatus).toHaveBeenCalledExactlyOnceWith(1, 'add_failed', {
      targetActions: { 'lidarr-1': { status: 'failed', error: failure.message } },
    })
  })
})

it.each(['artist', 'album'])(
  'keeps temporary auto-approval failures waiting for %s',
  async (kind) => {
    const deps = makeDeps({
      getRecommendationsByBatch: vi.fn().mockResolvedValue([
        {
          id: 1,
          score: 0.9,
          status: 'pending',
          kind,
          recommendedReleaseGroupId: 'rg-1',
          artist: { mbid: 'mbid-1', name: 'Artist A' },
        },
      ]),
    })
    const [target] = await deps.getEnabledTargets()
    if (!target) throw new Error('missing target')
    const fail = vi.fn().mockResolvedValue({
      success: false,
      targetType: 'lidarr',
      targetId: 1,
      error: 'HTTP 503: metadata server unavailable',
    })
    target.capabilities = ['addArtist', 'addAlbum']
    target.addArtist = fail
    target.addAlbum = fail
    const result = await autoApprove(1, { threshold: 0.7, monitorOption: 'all' }, deps)
    expect(result).toEqual({ approved: 1, failed: 0 })
    expect(deps.updateRecommendationStatus).toHaveBeenCalledWith(
      1,
      'waiting',
      expect.objectContaining({
        targetActions: {
          'lidarr-1': expect.objectContaining({
            status: 'waiting',
            retry: expect.objectContaining({ attempts: 1 }),
          }),
        },
      }),
    )
  },
)
