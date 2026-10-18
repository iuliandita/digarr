import { describe, expect, it, vi } from 'vitest'
import { targetAction } from '@/core/targets/lidarr-retry'
import { withApprovalLock } from '@/core/targets/lidarr-retry-worker'
import { updateSlskdRecommendationAction } from '@/core/targets/slskd-recommendation'
import type { RecommendationWithArtist } from '@/db/queries/recommendations'

describe('slskd recommendation updates', () => {
  it('reads after the approval lock and merges only the slskd action without losing waiting Lidarr work', async () => {
    let rec = { id: 987, status: 'approved', targetActions: {} } as RecommendationWithArtist
    const getRecommendation = vi.fn(async () => rec)
    const update = vi.fn(async (_id, status, extra) => {
      rec = { ...rec, ...extra, status }
    })
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const waiting = targetAction(
      { type: 'lidarr' },
      {
        success: false,
        targetType: 'lidarr',
        targetId: 1,
        error: 'HTTP 503',
      },
      {},
    )
    const approval = withApprovalLock(rec.id, async () => {
      await gate
      rec = {
        ...rec,
        status: 'waiting',
        targetActions: {
          'lidarr-1': waiting,
          'playlist-2': { status: 'failed', error: 'original' },
        },
      }
    })
    const pending = updateSlskdRecommendationAction(
      {
        getRecommendation,
        listJobs: async () => [{ state: 'failed', lastError: 'download failed' }],
        update,
      },
      rec.id,
      3,
      'failed',
    )
    await Promise.resolve()
    expect(getRecommendation).not.toHaveBeenCalled()
    release()
    await Promise.all([approval, pending])
    expect(rec.status).toBe('waiting')
    expect(update).toHaveBeenCalledWith(
      987,
      'waiting',
      expect.objectContaining({ preserveActedOnAt: true }),
    )
    expect(rec.targetActions).toEqual({
      'lidarr-1': waiting,
      'playlist-2': { status: 'failed', error: 'original' },
      'slskd-3': { status: 'failed', error: 'download failed' },
    })
  })
})
