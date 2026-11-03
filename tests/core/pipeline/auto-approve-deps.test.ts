import { describe, expect, it, vi } from 'vitest'
import { buildAutoApproveDeps } from '@/core/pipeline/auto-approve-deps'

function makeOptions(overrides: Partial<Parameters<typeof buildAutoApproveDeps>[0]> = {}) {
  return {
    userId: 7,
    user: null,
    listRecommendations: vi.fn(async () => ({ items: [] })),
    getEnabledTargets: vi.fn(async () => []),
    updateRecommendationStatus: vi.fn(async () => {}),
    ...overrides,
  } as Parameters<typeof buildAutoApproveDeps>[0]
}

describe('buildAutoApproveDeps', () => {
  it('fetches the batch with a 1000 item limit and projects only the fields auto-approve reads', async () => {
    const listRecommendations = vi.fn(async () => ({
      items: [
        {
          id: 1,
          score: 0.9,
          status: 'pending',
          kind: 'artist',
          recommendedReleaseGroupId: null,
          artist: { mbid: 'mbid-1', name: 'Artist', extra: 'dropped' },
          reasoning: 'dropped',
        },
      ],
    }))
    const deps = buildAutoApproveDeps(
      makeOptions({ listRecommendations: listRecommendations as never }),
    )

    expect(await deps.getRecommendationsByBatch(42)).toEqual([
      {
        id: 1,
        score: 0.9,
        status: 'pending',
        kind: 'artist',
        recommendedReleaseGroupId: null,
        artist: { mbid: 'mbid-1', name: 'Artist' },
      },
    ])
    expect(listRecommendations).toHaveBeenCalledWith({ batchId: 42, limit: 1000 })
  })

  it('passes the caller-owned target lookup, status writer, job recorder and user id through', () => {
    const options = makeOptions({ jobRecorder: { start: vi.fn() } as never })
    const deps = buildAutoApproveDeps(options)

    expect(deps.getEnabledTargets).toBe(options.getEnabledTargets)
    expect(deps.updateRecommendationStatus).toBe(options.updateRecommendationStatus)
    expect(deps.jobRecorder).toBe(options.jobRecorder)
    expect(deps.userId).toBe(7)
  })

  it.each([
    ['no user', null],
    ['direct policy', { approvalPolicy: 'direct', approvalThreshold: 0.8 }],
  ])('leaves canApprove unset for %s', (_name, user) => {
    expect(buildAutoApproveDeps(makeOptions({ user })).canApprove).toBeUndefined()
  })

  it('gates approvals on the user policy and threshold', async () => {
    const autoApprove = buildAutoApproveDeps(
      makeOptions({ user: { approvalPolicy: 'auto_approve', approvalThreshold: 0.8 } }),
    )
    expect(await autoApprove.canApprove?.(0.9)).toBe(true)
    expect(await autoApprove.canApprove?.(0.7)).toBe(false)

    const requestOnly = buildAutoApproveDeps(
      makeOptions({ user: { approvalPolicy: 'request_only' } }),
    )
    expect(await requestOnly.canApprove?.(1)).toBe(false)
  })

  it('warms artists through the warmer only when one is provided', async () => {
    expect(buildAutoApproveDeps(makeOptions()).warmArtist).toBeUndefined()
    expect(buildAutoApproveDeps(makeOptions({ skyhookWarmer: null })).warmArtist).toBeUndefined()

    const warmer = { warm: vi.fn(async () => {}) }
    const deps = buildAutoApproveDeps(makeOptions({ skyhookWarmer: warmer }))
    await deps.warmArtist?.('mbid-1')
    expect(warmer.warm).toHaveBeenCalledWith('mbid-1')
  })
})
