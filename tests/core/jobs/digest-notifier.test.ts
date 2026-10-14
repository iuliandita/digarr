// @vitest-environment node
import type { Cron } from 'croner'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type DigestNotifierDeps,
  startDigestNotifier,
  windowMsFromCron,
} from '@/core/jobs/digest-notifier'
import type { DispatchResult } from '@/core/notifications/registry'
import type { NotificationChannel } from '@/core/notifications/types'
import { setMaintenance } from '@/core/ops/maintenance'

const DAY_MS = 24 * 60 * 60 * 1000

const digestChannel: NotificationChannel = {
  id: 'w1',
  type: 'webhook',
  enabled: true,
  events: ['digest'],
  url: 'https://hooks.example.com/webhook',
}

function makeDeps(
  overrides: Partial<DigestNotifierDeps> = {},
  positions: Record<string, string | null> = {},
): DigestNotifierDeps {
  return {
    getDigestCron: () => '0 6 * * *',
    getChannels: () => [digestChannel],
    getStats: vi.fn(async () => ({ discovered: 0, added: 0, runs: 0 })),
    dispatch: vi.fn(async (channels: NotificationChannel[]) =>
      channels.map((channel) => ({ id: channel.id, type: channel.type, ok: true })),
    ),
    initializeDeliveryPositions: vi.fn(async (ids: string[]) => {
      for (const id of ids) {
        if (!Object.hasOwn(positions, id)) {
          Object.defineProperty(positions, id, {
            value: null,
            writable: true,
            enumerable: true,
            configurable: true,
          })
        }
      }
      return { ...positions }
    }),
    getDeliveryPositions: vi.fn(async () => ({ ...positions })),
    setDeliveryPosition: vi.fn(async (id: string, at: Date) => {
      Object.defineProperty(positions, id, {
        value: at.toISOString(),
        writable: true,
        enumerable: true,
        configurable: true,
      })
    }),
    ...overrides,
  }
}

/** Trigger the cron's scheduled callback and await its body. */
async function fire(cron: Cron): Promise<void> {
  await cron.trigger()
}

describe('windowMsFromCron', () => {
  it('derives ~1 day for a daily cron, fired at the scheduled time', () => {
    // 2024-01-05 (Friday) 06:00 local, a fire of '0 6 * * *'.
    const from = new Date(2024, 0, 5, 6, 0, 0, 0)
    expect(windowMsFromCron('0 6 * * *', from)).toBe(DAY_MS)
  })

  it('derives ~7 days for a weekly cron, fired at the scheduled time', () => {
    // 2024-01-08 (Monday) 06:00 local, a fire of '0 6 * * 1'.
    const from = new Date(2024, 0, 8, 6, 0, 0, 0)
    expect(windowMsFromCron('0 6 * * 1', from)).toBe(7 * DAY_MS)
  })

  it('derives the actual elapsed interval for an irregular Mon+Fri cron', () => {
    // 2024-01-05 (Friday) 08:00 local, a fire of '0 8 * * 1,5'. The
    // previous fire was Monday 2024-01-01, so the elapsed window is 4
    // days -- NOT the 3-day gap to the *next* fire (the following Monday),
    // which is what the old future-gap derivation returned.
    const from = new Date(2024, 0, 5, 8, 0, 0, 0)
    expect(windowMsFromCron('0 8 * * 1,5', from)).toBe(4 * DAY_MS)
  })

  it('derives the elapsed interval when the tick fires seconds late', () => {
    // Friday 08:00:05 -- the tick ran 5s after the scheduled fire, so the
    // Friday fire itself shows up as a "previous" run and must be skipped;
    // the window still reaches back to Monday.
    const from = new Date(2024, 0, 5, 8, 0, 5, 0)
    expect(windowMsFromCron('0 8 * * 1,5', from)).toBe(4 * DAY_MS + 5000)
  })

  it('falls back to 1 day on an invalid cron', () => {
    expect(windowMsFromCron('not a cron')).toBe(DAY_MS)
  })
})

describe('startDigestNotifier', () => {
  const now = new Date(2024, 0, 5, 6, 0, 0, 0)
  const old = new Date(2024, 0, 2, 6, 0, 0, 0).toISOString()
  const stats = { discovered: 9, added: 3, runs: 4 }
  const jobs: Cron[] = []

  async function start(deps: DigestNotifierDeps): Promise<Cron> {
    const job = await startDigestNotifier(deps)
    if (!job) throw new Error('Expected a configured digest schedule')
    jobs.push(job)
    return job
  }

  afterEach(() => {
    for (const job of jobs.splice(0)) job.stop()
    setMaintenance(false)
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function freeze() {
    vi.useFakeTimers()
    vi.setSystemTime(now)
  }

  it('initializes existing IDs once even when cron and channel delivery are disabled', async () => {
    const channels = [digestChannel, { ...digestChannel, id: 'paused', enabled: false }]
    const positions = { w1: old }
    const deps = makeDeps(
      { getDigestCron: () => undefined, getChannels: () => channels },
      positions,
    )
    expect(await startDigestNotifier(deps)).toBeNull()
    expect(deps.initializeDeliveryPositions).toHaveBeenCalledExactlyOnceWith(['w1', 'paused'])
    expect(positions.w1).toBe(old)
    expect(deps.dispatch).not.toHaveBeenCalled()
  })

  it.each(['no cron', 'empty', 'unsubscribed', 'disabled', 'maintenance'])(
    'pauses delivery without advancing positions during %s',
    async (mode) => {
      freeze()
      let cron: string | undefined = '0 6 * * *'
      let channels: NotificationChannel[] = [digestChannel]
      const deps = makeDeps({ getDigestCron: () => cron, getChannels: () => channels })
      const job = await start(deps)
      if (mode === 'no cron') cron = undefined
      if (mode === 'empty') channels = []
      if (mode === 'unsubscribed') channels = [{ ...digestChannel, events: ['batch_complete'] }]
      if (mode === 'disabled') channels = [{ ...digestChannel, enabled: false }]
      if (mode === 'maintenance') setMaintenance(true)
      await fire(job)
      expect(deps.initializeDeliveryPositions).toHaveBeenCalledOnce()
      expect(deps.getDeliveryPositions).not.toHaveBeenCalled()
      expect(deps.dispatch).not.toHaveBeenCalled()
      expect(deps.setDeliveryPosition).not.toHaveBeenCalled()
    },
  )

  it('advances only each successful or empty window while preserving failed channel history', async () => {
    freeze()
    const positions = {
      w1: old,
      failed: new Date(now.getTime() - 2 * DAY_MS).toISOString(),
      empty: new Date(now.getTime() - DAY_MS).toISOString(),
    }
    const channels = ['w1', 'failed', 'empty'].map((id) => ({ ...digestChannel, id }))
    const getStats = vi.fn(async (since: Date) =>
      since.toISOString() === positions.empty ? { discovered: 0, added: 0, runs: 0 } : stats,
    )
    const dispatch = vi.fn(async ([channel]: NotificationChannel[]) => [
      { id: channel?.id ?? '', type: 'webhook', ok: channel?.id !== 'failed' },
    ])
    const deps = makeDeps({ getChannels: () => channels, getStats, dispatch }, positions)
    const failedStart = positions.failed
    const emptyStart = positions.empty
    await fire(await start(deps))
    expect(getStats.mock.calls.map(([since]) => since.toISOString())).toEqual([
      old,
      failedStart,
      emptyStart,
    ])
    expect(positions).toEqual({
      w1: now.toISOString(),
      failed: failedStart,
      empty: now.toISOString(),
    })
    expect(dispatch.mock.calls.map(([targets]) => targets.map((channel) => channel.id))).toEqual([
      ['w1'],
      ['failed'],
    ])
    expect(vi.mocked(deps.dispatch).mock.calls[0]?.[2]).toMatchObject({
      event: 'digest',
      window: 'day',
      stats,
      message: expect.any(String),
      timestamp: now.toISOString(),
    })
  })

  it('uses the restored legacy window while the existing scheduler remains running', async () => {
    freeze()
    let positions: Record<string, string | null> | null = { w1: now.toISOString() }
    let legacy: string | null = null
    const getStats = vi.fn(async (_since: Date) => stats)
    const deps = makeDeps({
      getStats,
      initializeDeliveryPositions: vi.fn(async (ids: string[]) => {
        if (positions === null) positions = Object.fromEntries(ids.map((id) => [id, legacy]))
        return { ...positions }
      }),
      getDeliveryPositions: vi.fn(async () => ({ ...positions })),
      setDeliveryPosition: vi.fn(async (id: string, at: Date) => {
        positions = { ...(positions ?? {}), [id]: at.toISOString() }
      }),
    })
    const job = await start(deps)
    positions = null
    legacy = old
    await fire(job)
    expect(getStats).toHaveBeenCalledExactlyOnceWith(new Date(old))
    expect(deps.dispatch).toHaveBeenCalledOnce()
    expect(positions).toEqual({ w1: now.toISOString() })
    expect(deps.setDeliveryPosition).toHaveBeenCalledExactlyOnceWith('w1', now)
  })

  it.each([null, 'invalid', new Date(now.getTime() + DAY_MS).toISOString()])(
    'persists a cadence fallback for %s and retries the expanded window after restart',
    async (position) => {
      freeze()
      const positions = { w1: position }
      const getStats = vi.fn(async (_since: Date) => stats)
      const dispatch = vi.fn(async () => [{ id: 'w1', type: 'webhook', ok: false }])
      const deps = makeDeps({ getStats, dispatch }, positions)
      const job = await start(deps)
      await fire(job)
      const since = new Date(now.getTime() - DAY_MS)
      expect(positions.w1).toBe(since.toISOString())
      expect(vi.mocked(deps.setDeliveryPosition).mock.invocationCallOrder[0]).toBeLessThan(
        getStats.mock.invocationCallOrder[0] ?? 0,
      )
      job.stop()
      vi.setSystemTime(new Date(now.getTime() + DAY_MS))
      dispatch.mockResolvedValue([{ id: 'w1', type: 'webhook', ok: true }])
      await fire(await start(deps))
      expect(getStats.mock.calls.map(([startAt]) => startAt)).toEqual([since, since])
      expect(positions.w1).toBe(new Date(now.getTime() + DAY_MS).toISOString())
    },
  )

  it.each<DispatchResult[]>([
    [],
    [{ id: 'another', type: 'webhook', ok: true }],
    [{ id: 'w1', type: 'ntfy', ok: true }],
    [{ id: 'w1', type: 'webhook', ok: false }],
    [
      { id: 'w1', type: 'webhook', ok: true },
      { id: 'extra', type: 'webhook', ok: true },
    ],
  ])('requires one matching successful dispatch result: %j', async (...results) => {
    freeze()
    const positions = { w1: old }
    const deps = makeDeps(
      { getStats: async () => stats, dispatch: vi.fn(async () => results) },
      positions,
    )
    await fire(await start(deps))
    expect(positions.w1).toBe(old)
    expect(deps.setDeliveryPosition).not.toHaveBeenCalled()
  })

  it.each(['stats', 'first write', 'dispatch', 'last write'])(
    'isolates a channel %s error and still delivers the other channel',
    async (failure) => {
      freeze()
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const positions: Record<string, string | null> = {
        w1: failure === 'first write' ? null : old,
        other: old,
      }
      const deps = makeDeps(
        {
          getChannels: () => [digestChannel, { ...digestChannel, id: 'other' }],
          getStats: async () => stats,
        },
        positions,
      )
      const persist = deps.setDeliveryPosition
      deps.setDeliveryPosition = vi.fn(async (id: string, at: Date) => {
        if (id === 'w1' && (failure === 'first write' || failure === 'last write'))
          throw new Error('write failed')
        await persist(id, at)
      })
      if (failure === 'stats')
        deps.getStats = vi
          .fn()
          .mockRejectedValueOnce(new Error('query failed'))
          .mockResolvedValue(stats)
      if (failure === 'dispatch')
        deps.dispatch = vi
          .fn()
          .mockRejectedValueOnce(new Error('send failed'))
          .mockResolvedValue([{ id: 'other', type: 'webhook', ok: true }])
      await fire(await start(deps))
      expect(positions.w1).toBe(failure === 'first write' ? null : old)
      expect(positions.other).toBe(now.toISOString())
      expect(console.error).toHaveBeenCalledWith(
        '[digest-notifier] Channel failed:',
        'w1',
        expect.any(Error),
      )
      if (failure === 'first write')
        expect(vi.mocked(deps.dispatch).mock.calls.map(([targets]) => targets[0]?.id)).toEqual([
          'other',
        ])
    },
  )

  it('skips an already covered window at the same instant', async () => {
    freeze()
    const deps = makeDeps({}, { w1: now.toISOString() })
    await fire(await start(deps))
    expect(deps.getStats).not.toHaveBeenCalled()
    expect(deps.setDeliveryPosition).not.toHaveBeenCalled()
  })

  it('retains paused and removed IDs, resumes changed destinations, and starts new IDs at cadence', async () => {
    freeze()
    const positions = { w1: old }
    let channels: NotificationChannel[] = [{ ...digestChannel, enabled: false }]
    const getStats = vi.fn(async (_since: Date) => stats)
    const deps = makeDeps(
      {
        getChannels: () => channels,
        getStats,
        dispatch: vi.fn(async (targets: NotificationChannel[]) =>
          targets.map((channel) => ({ id: channel.id, type: channel.type, ok: false })),
        ),
      },
      positions,
    )
    const job = await start(deps)
    await fire(job)
    channels = []
    await fire(job)
    expect(positions.w1).toBe(old)
    channels = [
      {
        id: 'w1',
        type: 'ntfy',
        enabled: true,
        events: ['digest'],
        server: 'https://ntfy.example.com',
        topic: 'changed',
      },
      { ...digestChannel, id: '__proto__' },
    ]
    await fire(job)
    expect(getStats.mock.calls.map(([since]) => since)).toEqual([
      new Date(old),
      new Date(now.getTime() - DAY_MS),
    ])
    expect(positions.w1).toBe(old)
    expect(Object.hasOwn(positions, '__proto__')).toBe(true)
    expect(Object.getOwnPropertyDescriptor(positions, '__proto__')?.value).toBe(
      new Date(now.getTime() - DAY_MS).toISOString(),
    )
    expect(deps.initializeDeliveryPositions).toHaveBeenCalledTimes(2)
  })

  it('skips duplicate IDs even when one duplicate is disabled and delivers unique IDs', async () => {
    freeze()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const positions = { w1: old, unique: old }
    const deps = makeDeps(
      {
        getChannels: () => [
          digestChannel,
          { ...digestChannel, enabled: false },
          { ...digestChannel, id: 'unique' },
        ],
        getStats: async () => stats,
      },
      positions,
    )
    await fire(await start(deps))
    expect(vi.mocked(deps.dispatch).mock.calls.map(([targets]) => targets[0]?.id)).toEqual([
      'unique',
    ])
    expect(positions).toEqual({ w1: old, unique: now.toISOString() })
    expect(console.error).toHaveBeenCalledWith(
      '[digest-notifier] Duplicate channel ID skipped:',
      'w1',
    )
  })

  it('releases the overlap guard when restored position initialization fails', async () => {
    freeze()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const inFlight = { running: false }
    const deps = makeDeps({ inFlight, getStats: vi.fn(async () => stats) }, { w1: old })
    const job = await start(deps)
    vi.mocked(deps.initializeDeliveryPositions).mockRejectedValueOnce(
      new Error('restore unavailable'),
    )
    await fire(job)
    expect(deps.getDeliveryPositions).not.toHaveBeenCalled()
    expect(deps.dispatch).not.toHaveBeenCalled()
    expect(inFlight.running).toBe(false)
    expect(console.error).toHaveBeenCalledWith('[digest-notifier] Failed:', expect.any(Error))
    await fire(job)
    expect(deps.dispatch).toHaveBeenCalledOnce()
    expect(inFlight.running).toBe(false)
  })

  it('shares the overlap guard across reentrant ticks and scheduler replacement, then releases it', async () => {
    freeze()
    const inFlight = { running: false }
    let release: (() => void) | undefined
    let entered: (() => void) | undefined
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const entering = new Promise<void>((resolve) => {
      entered = resolve
    })
    const getStats = vi.fn(async () => {
      entered?.()
      await pending
      return stats
    })
    const deps = makeDeps({ inFlight, getStats }, { w1: old })
    const first = await start(deps)
    const tick = fire(first)
    await entering
    await fire(first)
    first.stop()
    const replacement = await start(deps)
    await fire(replacement)
    expect(getStats).toHaveBeenCalledOnce()
    release?.()
    await tick
    expect(inFlight.running).toBe(false)
    vi.setSystemTime(new Date(now.getTime() + DAY_MS))
    await fire(replacement)
    expect(getStats).toHaveBeenCalledTimes(2)
    expect(deps.dispatch).toHaveBeenCalledTimes(2)
  })
})
