import { describe, expect, it, vi } from 'vitest'
import {
  isTemporaryLidarrFailure,
  LIDARR_RETRY_WINDOW,
  targetAction,
} from '@/core/targets/lidarr-retry'
import { type LidarrRetryDeps, retryWaitingApprovals } from '@/core/targets/lidarr-retry-worker'
import type { RecommendationWithArtist } from '@/db/queries/recommendations'

const now = Date.parse('2026-10-18T12:00:00Z')
const failure = {
  success: false,
  targetType: 'lidarr',
  targetId: 1,
  error: 'HTTP 503: SkyHook unavailable',
}

describe('Lidarr deferred approvals', () => {
  it.each([
    ['HTTP 500 from http://lidarr: error', true],
    ['HTTP 502: bad gateway', true],
    ['HTTP 500: metadata validation unavailable', true],
    ['HTTP 503: unavailable', true],
    ['HTTP 504: gateway timeout', true],
    ['Request timed out after 10000ms', true],
    ['connect ECONNREFUSED', true],
    ['read ECONNRESET', true],
    ['fetch failed', true],
    ['Unable to connect to server', true],
    ['SkyHook lookup failed', true],
    ['metadata server unavailable', true],
    ['failed to retrieve artist metadata', true],
    ['HTTP 400: validation failure', false],
    ['HTTP 401: SkyHook unauthorized', false],
    ['HTTP 403: forbidden', false],
    ['HTTP 404: artist not found', false],
    ['HTTP 409: artist already exists', false],
    ['HTTP 422: bad profile', false],
    ['artist already exists', false],
    ['Root folder with id 503 not found', false],
    ['No root folders configured in Lidarr', false],
    ['Invalid quality profile', false],
    ['album not found in Lidarr', false],
  ])('classifies %s as temporary=%s', (error, temporary) => {
    expect(isTemporaryLidarrFailure(error)).toBe(temporary)
  })

  function setup() {
    const action = targetAction(
      { type: 'lidarr' },
      failure,
      { monitorOption: 'all' },
      undefined,
      now - 5 * 60_000,
    )
    let rec = {
      id: 1,
      userId: 7,
      status: 'waiting',
      kind: 'artist',
      lidarrArtistId: null,
      artist: { mbid: 'mbid', name: 'Artist' },
      targetActions: { 'lidarr-1': action },
    } as unknown as RecommendationWithArtist
    const addArtist = vi
      .fn()
      .mockResolvedValue({ success: true, targetType: 'lidarr', targetId: 1, externalId: 42 })
    const deps: LidarrRetryDeps = {
      listWaiting: async () => (rec.status === 'waiting' ? [rec] : []),
      getRecommendation: async () => rec,
      isBlocked: vi.fn(async () => false),
      getTargets: vi.fn(async () => [
        {
          id: 'lidarr-1',
          name: 'Lidarr',
          type: 'lidarr' as const,
          capabilities: ['addArtist' as const],
          addArtist,
          testConnection: vi.fn(),
        },
      ]),
      update: vi.fn(async (_id, status, extra) => {
        rec = { ...rec, ...extra, status }
      }),
      notify: vi.fn(),
      recorder: {
        start: vi.fn(async () => 9),
        complete: vi.fn(),
        fail: vi.fn(),
        cancel: vi.fn(),
        markStuck: vi.fn(),
      },
      now: () => now,
    }
    return { deps, addArtist, getRec: () => rec }
  }

  it('retries only due work using the owner and saved options, recording history', async () => {
    const { deps, addArtist, getRec } = setup()
    await retryWaitingApprovals(deps)
    expect(deps.getTargets).toHaveBeenCalledWith(7)
    expect(addArtist).toHaveBeenCalledWith(
      { mbid: 'mbid', name: 'Artist' },
      expect.objectContaining({
        retryExisting: true,
        monitorOption: 'all',
        userId: 7,
        recommendationId: 1,
      }),
    )
    expect(getRec().status).toBe('added_to_lidarr')
    expect(getRec().lidarrArtistId).toBe(42)
    expect(deps.recorder.start).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'target',
        metadata: expect.objectContaining({ attempt: 2 }),
      }),
    )
    expect(deps.recorder.complete).toHaveBeenCalledWith(9, expect.anything())
    await retryWaitingApprovals(deps)
    expect(addArtist).toHaveBeenCalledTimes(1)
  })

  it('records album retries as album operations without storing the album ID as an artist ID', async () => {
    const { deps, addArtist, getRec } = setup()
    getRec().kind = 'album'
    getRec().recommendedReleaseGroupId = 'rg-1'
    const targets = await deps.getTargets(7)
    deps.getTargets = vi.fn(async () => targets)
    const [target] = targets
    if (!target) throw new Error('missing target')
    target.addAlbum = addArtist
    await retryWaitingApprovals(deps)
    expect(addArtist).toHaveBeenCalledWith(
      { artistMbid: 'mbid', artistName: 'Artist', releaseGroupMbid: 'rg-1' },
      expect.objectContaining({ retryExisting: true }),
    )
    expect(deps.recorder.start).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          action: 'addAlbum',
          retry: true,
          releaseGroupMbid: 'rg-1',
        }),
      }),
    )
    expect(deps.update).toHaveBeenCalledWith(
      1,
      'added_to_lidarr',
      expect.objectContaining({
        lidarrArtistId: undefined,
        targetActions: { 'lidarr-1': expect.objectContaining({ externalId: 42, status: 'added' }) },
      }),
    )
  })

  it('persists increasing backoff and leaves future work alone', async () => {
    const { deps, addArtist, getRec } = setup()
    addArtist.mockResolvedValue(failure)
    await retryWaitingApprovals(deps)
    expect(getRec().targetActions?.['lidarr-1']).toMatchObject({
      status: 'waiting',
      retry: { attempts: 2, nextAttemptAt: new Date(now + 15 * 60_000).toISOString() },
    })
    expect(deps.recorder.fail).toHaveBeenCalledWith(9, failure.error)
    await retryWaitingApprovals(deps)
    expect(addArtist).toHaveBeenCalledTimes(1)
  })

  it('expires without re-adding and sends one notification across repeated ticks', async () => {
    const { deps, addArtist, getRec } = setup()
    deps.now = () => now + LIDARR_RETRY_WINDOW
    await retryWaitingApprovals(deps)
    expect(addArtist).not.toHaveBeenCalled()
    expect(getRec().status).toBe('add_failed')
    expect(getRec().lidarrError).toBe(failure.error)
    expect(deps.notify).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'approval_failed', recommendationId: 1 }),
    )
    await retryWaitingApprovals(deps)
    expect(deps.notify).toHaveBeenCalledTimes(1)
  })

  it('does not use disabled or reassigned targets or revive rejected work', async () => {
    const { deps, addArtist, getRec } = setup()
    deps.getTargets = vi.fn(async () => [])
    await retryWaitingApprovals(deps)
    expect(addArtist).not.toHaveBeenCalled()
    expect(getRec().status).toBe('waiting')
    await deps.update(1, 'rejected', {})
    deps.listWaiting = async () => [getRec()]
    await retryWaitingApprovals(deps)
    expect(deps.recorder.start).not.toHaveBeenCalled()
  })

  it.each(['artist', 'album'] as const)(
    'fails a blocked %s without attempting or alerting',
    async (kind) => {
      const { deps, addArtist, getRec } = setup()
      getRec().kind = kind
      getRec().recommendedReleaseGroupId = kind === 'album' ? 'rg-1' : null
      deps.isBlocked = vi.fn(async () => true)
      await retryWaitingApprovals(deps)
      expect(deps.isBlocked).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 7,
          kind,
          artist: { mbid: 'mbid', name: 'Artist' },
          recommendedReleaseGroupId: kind === 'album' ? 'rg-1' : null,
        }),
      )
      expect(addArtist).not.toHaveBeenCalled()
      expect(deps.recorder.start).not.toHaveBeenCalled()
      expect(getRec().targetActions?.['lidarr-1']).toMatchObject({
        status: 'failed',
        error: expect.stringContaining('blocked'),
      })
      expect(getRec().status).toBe('add_failed')
      expect(deps.notify).not.toHaveBeenCalled()
    },
  )

  it.each([false, true])(
    'keeps a successful target when another expires (already notified=%s)',
    async (alreadyNotified) => {
      const { deps, getRec } = setup()
      getRec().targetActions = {
        ...getRec().targetActions,
        'lidarr-2': { status: 'added', externalId: 42 },
        ...(alreadyNotified
          ? { 'lidarr-3': { status: 'failed', failureNotifiedAt: new Date(now).toISOString() } }
          : {}),
      }
      deps.now = () => now + LIDARR_RETRY_WINDOW
      await retryWaitingApprovals(deps)
      expect(getRec().status).toBe('added_to_lidarr')
      expect(deps.notify).toHaveBeenCalledTimes(alreadyNotified ? 0 : 1)
    },
  )

  it.each(['getTargets', 'start', 'complete', 'fail', 'update', 'getLocale', 'notify'] as const)(
    'continues to later candidates when %s throws',
    async (point) => {
      const first = setup()
      const second = setup()
      second.getRec().id = 2
      second.getRec().userId = 8
      const deps = first.deps
      deps.listWaiting = async () => [first.getRec(), second.getRec()]
      deps.getRecommendation = async (id) => (id === 1 ? first.getRec() : second.getRec())
      const originalTargets = deps.getTargets
      deps.getTargets = vi.fn(async (userId) =>
        userId === 7 ? originalTargets(userId) : second.deps.getTargets(userId),
      )
      const originalUpdate = deps.update
      deps.update = vi.fn(async (id, status, extra) =>
        id === 1 ? originalUpdate(id, status, extra) : second.deps.update(id, status, extra),
      )
      const failureMessage =
        'HTTP 503 from https://private-host/path?apikey=secret: password=hunter2'
      const throwing = vi.fn()
      if (point === 'getTargets')
        deps.getTargets = throwing
          .mockImplementationOnce(async () => {
            throw new Error(failureMessage)
          })
          .mockImplementation(second.deps.getTargets)
      else if (point === 'update')
        deps.update = throwing
          .mockImplementationOnce(async () => {
            throw new Error(failureMessage)
          })
          .mockImplementation(second.deps.update)
      else if (point === 'getLocale' || point === 'notify') {
        deps.now = () => now + LIDARR_RETRY_WINDOW
        if (point === 'getLocale')
          deps.getLocale = throwing.mockRejectedValueOnce(new Error(failureMessage))
        else deps.notify = throwing.mockRejectedValueOnce(new Error(failureMessage))
      } else {
        if (point === 'fail') first.addArtist.mockResolvedValue(failure)
        deps.recorder[point] = throwing.mockRejectedValueOnce(new Error(failureMessage))
      }
      const log = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        await retryWaitingApprovals(deps)
        expect(second.getRec().status).toBe(
          point === 'getLocale' || point === 'notify' ? 'add_failed' : 'added_to_lidarr',
        )
        expect(log).toHaveBeenCalledWith(expect.stringContaining('Recommendation 1'))
        expect(log.mock.calls.flat().join(' ')).not.toMatch(/private-host|hunter2|apikey=secret/)
      } finally {
        log.mockRestore()
      }
    },
  )

  it.each(['getTargets', 'start'] as const)(
    'expires even when %s keeps throwing',
    async (point) => {
      const { deps, addArtist, getRec } = setup()
      const throwing = vi.fn(async () => {
        throw new Error('service unavailable')
      })
      if (point === 'getTargets') deps.getTargets = throwing
      else deps.recorder.start = throwing
      const log = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        await retryWaitingApprovals(deps)
        expect(getRec().status).toBe('waiting')
        deps.now = () => now + LIDARR_RETRY_WINDOW
        await retryWaitingApprovals(deps)
        expect(getRec().status).toBe('add_failed')
        expect(throwing).toHaveBeenCalledTimes(1)
        expect(addArtist).not.toHaveBeenCalled()
        expect(deps.notify).toHaveBeenCalledTimes(1)
      } finally {
        log.mockRestore()
      }
    },
  )

  it('redacts and caps errors before saving history, retry state, and notifications', async () => {
    const { deps, addArtist, getRec } = setup()
    addArtist.mockResolvedValue({
      ...failure,
      error: `HTTP 503 from https://host.private/api?apikey=sekret: password=hunter2 ${'x'.repeat(3000)}`,
    })
    await retryWaitingApprovals(deps)
    const error = getRec().lidarrError ?? ''
    expect(error.length).toBe(2048)
    expect(error).not.toMatch(/host.private|sekret|hunter2/)
    expect(deps.recorder.fail).toHaveBeenCalledWith(9, error)
    deps.now = () => now + LIDARR_RETRY_WINDOW
    await retryWaitingApprovals(deps)
    expect(deps.notify).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining(error) }),
    )
  })
})

it('finishes the saved combined acquisition only after Lidarr recovers', async () => {
  const action = targetAction(
    { type: 'lidarr' },
    failure,
    { monitorOption: 'none', followUpTargetId: 'slskd-2' },
    undefined,
    now - 300000,
  )
  let rec = {
    id: 1,
    userId: 7,
    status: 'waiting',
    kind: 'artist',
    artist: { mbid: 'mbid', name: 'Artist' },
    targetActions: { 'lidarr-1': action },
  } as unknown as RecommendationWithArtist
  const slskdAdd = vi
    .fn()
    .mockResolvedValue({ success: true, targetType: 'slskd', targetId: 2, externalId: 8 })
  const lidarrAdd = vi
    .fn()
    .mockResolvedValue({ success: false, targetType: 'lidarr', targetId: 1, error: 'HTTP 503' })
  const deps: LidarrRetryDeps = {
    listWaiting: async () => [rec],
    getRecommendation: async () => rec,
    isBlocked: vi.fn(async () => false),
    getTargets: async () => [
      {
        id: 'lidarr-1',
        name: 'Lidarr',
        type: 'lidarr',
        capabilities: ['addArtist'],
        addArtist: lidarrAdd,
        testConnection: vi.fn(),
      },
      {
        id: 'slskd-2',
        name: 'slskd',
        type: 'slskd',
        capabilities: ['addArtist'],
        addArtist: slskdAdd,
        testConnection: vi.fn(),
      },
    ],
    update: async (_id, status, extra) => {
      rec = { ...rec, ...extra, status }
    },
    notify: vi.fn(),
    recorder: {
      start: vi.fn(async () => 1),
      complete: vi.fn(),
      fail: vi.fn(),
      cancel: vi.fn(),
      markStuck: vi.fn(),
    },
    now: () => now,
  }
  await retryWaitingApprovals(deps)
  expect(slskdAdd).not.toHaveBeenCalled()
  lidarrAdd.mockResolvedValue({
    success: true,
    targetType: 'lidarr',
    targetId: 1,
    externalId: 42,
  } as never)
  deps.now = () => now + 15 * 60000
  await retryWaitingApprovals(deps)
  expect(slskdAdd).toHaveBeenCalledWith(
    { mbid: 'mbid', name: 'Artist' },
    expect.objectContaining({ lidarrArtistId: 42, userId: 7, recommendationId: 1 }),
  )
  expect(rec.targetActions?.['slskd-2']).toMatchObject({ status: 'queued' })
})
