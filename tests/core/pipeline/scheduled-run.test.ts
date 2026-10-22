// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { JobRecorder } from '@/core/jobs/types'
import type { AutoApproveDeps } from '@/core/pipeline/auto-approve'
import type { PipelineDeps } from '@/core/pipeline/orchestrator'
import { createScheduledPipelineRunner } from '@/core/pipeline/scheduled-run'
import type { UserConnections } from '@/db/queries/users'

function makeJobRecorder(): JobRecorder {
  return {
    start: vi.fn(async () => 1),
    complete: vi.fn(async () => undefined),
    fail: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    markStuck: vi.fn(async () => 0),
  }
}

function makeUserContext(userId: number) {
  const userConnections = {
    listenbrainzUsername: `listener-${userId}`,
    listenbrainzToken: 'token',
  } as unknown as UserConnections
  const autoApproveDeps = { userId } as unknown as AutoApproveDeps
  const settings = {
    preferences: { scoreThreshold: 0.1 * userId },
    spotifyAccessToken: `spotify-${userId}`,
  } as unknown as PipelineDeps['settings']
  return {
    db: {} as PipelineDeps['db'],
    settings,
    providerRegistry: {} as NonNullable<PipelineDeps['providerRegistry']>,
    librarySync: { syncForUser: vi.fn(async () => undefined) },
    userConnections,
    autoApproveDeps,
  } satisfies Omit<PipelineDeps, 'userId' | 'jobRecorder' | 'trigger'>
}

function setup(users: Array<{ id: number; isAdmin: boolean }>) {
  const enqueue = vi.fn((_deps: PipelineDeps) => ({ status: 'started' as const, position: 0 }))
  const jobRecorder = makeJobRecorder()
  const buildPipelineDeps = vi.fn(async (userId: number) => makeUserContext(userId))
  const runScheduled = createScheduledPipelineRunner({
    orchestrator: { enqueue },
    jobRecorder,
    listUsers: async () => users,
    buildPipelineDeps,
  })
  return { enqueue, jobRecorder, buildPipelineDeps, runScheduled }
}

describe('createScheduledPipelineRunner', () => {
  it('runs the cron scan with the same user context as a manual run', async () => {
    const { enqueue, jobRecorder, buildPipelineDeps, runScheduled } = setup([
      { id: 2, isAdmin: false },
      { id: 5, isAdmin: true },
    ])

    await runScheduled()

    expect(buildPipelineDeps).toHaveBeenCalledExactlyOnceWith(5)
    expect(enqueue).toHaveBeenCalledTimes(1)
    const deps = enqueue.mock.calls[0]?.[0]
    const expected = makeUserContext(5)
    expect(deps?.userId).toBe(5)
    expect(deps?.userConnections).toEqual(expected.userConnections)
    expect(deps?.autoApproveDeps).toEqual(expected.autoApproveDeps)
    expect(deps?.settings).toEqual(expected.settings)
    expect(deps?.providerRegistry).toBeDefined()
    expect(deps?.librarySync).toBeDefined()
    expect(deps?.jobRecorder).toBe(jobRecorder)
    expect(deps?.trigger).toBe('scheduled')
  })

  it('falls back to the first user when nobody is an admin', async () => {
    const { enqueue, runScheduled } = setup([
      { id: 3, isAdmin: false },
      { id: 4, isAdmin: false },
    ])

    await runScheduled()

    expect(enqueue.mock.calls[0]?.[0].userId).toBe(3)
  })

  it('honors an explicit user id without listing users', async () => {
    const listUsers = vi.fn(async () => [{ id: 1, isAdmin: true }])
    const enqueue = vi.fn((_deps: PipelineDeps) => ({ status: 'started' as const, position: 0 }))
    const runScheduled = createScheduledPipelineRunner({
      orchestrator: { enqueue },
      jobRecorder: makeJobRecorder(),
      listUsers,
      buildPipelineDeps: async (userId) => makeUserContext(userId),
    })

    await runScheduled(9)

    expect(listUsers).not.toHaveBeenCalled()
    expect(enqueue.mock.calls[0]?.[0].userId).toBe(9)
  })

  it('does nothing when there are no users', async () => {
    const { enqueue, buildPipelineDeps, runScheduled } = setup([])

    await runScheduled()

    expect(buildPipelineDeps).not.toHaveBeenCalled()
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('does nothing when the pipeline context is unavailable (settings missing)', async () => {
    const enqueue = vi.fn((_deps: PipelineDeps) => ({ status: 'started' as const, position: 0 }))
    const runScheduled = createScheduledPipelineRunner({
      orchestrator: { enqueue },
      jobRecorder: makeJobRecorder(),
      listUsers: async () => [{ id: 1, isAdmin: true }],
      buildPipelineDeps: async () => null,
    })

    await runScheduled()

    expect(enqueue).not.toHaveBeenCalled()
  })
})
