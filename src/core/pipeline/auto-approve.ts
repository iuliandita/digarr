import { recordFailureSafely } from '@/core/jobs/record-failure-safely'
import {
  hasWaitingAction,
  isTemporaryLidarrFailure,
  targetAction,
} from '@/core/targets/lidarr-retry'
import type { DestinationTarget, TargetAddOptions } from '@/core/targets/types'
import { errMsg } from '@/core/validation'
import type { StatusUpdateExtra } from '@/db/queries/recommendations'
import { checkPipelineCancelled } from './cancel'

export type AutoApproveDeps = {
  getRecommendationsByBatch: (batchId: number) => Promise<
    Array<{
      id: number
      score: number
      status: string
      kind: string
      recommendedReleaseGroupId: string | null
      artist: { mbid: string; name: string }
    }>
  >
  getEnabledTargets: () => Promise<DestinationTarget[]>
  updateRecommendationStatus: (
    id: number,
    status: string,
    extra?: StatusUpdateExtra,
  ) => Promise<void>
  warmArtist?: (mbid: string) => Promise<void>
  jobRecorder?: import('@/core/jobs/types').JobRecorder
  userId?: number
  canApprove?: (score: number) => Promise<boolean>
}

type AutoApproveConfig = {
  threshold: number
  monitorOption: 'all' | 'new' | 'missing' | 'existing' | 'latest' | 'first' | 'none'
}

export async function autoApprove(
  batchId: number,
  config: AutoApproveConfig,
  deps: AutoApproveDeps,
  signal?: AbortSignal,
): Promise<{ approved: number; failed: number }> {
  checkPipelineCancelled(signal)
  const recs = await deps.getRecommendationsByBatch(batchId)
  checkPipelineCancelled(signal)
  const eligible = recs.filter((r) => r.status === 'pending' && r.score >= config.threshold)

  if (eligible.length === 0) return { approved: 0, failed: 0 }

  const targets = await deps.getEnabledTargets()
  checkPipelineCancelled(signal)
  const addTargets = targets.filter((t) => t.capabilities?.includes('addArtist'))
  const albumTargets = targets.filter(
    (t) => t.capabilities?.includes('addAlbum') && typeof t.addAlbum === 'function',
  )
  const hasAcquisitionTargets = targets.some(
    (t) => t.capabilities?.includes('addArtist') || t.capabilities?.includes('addAlbum'),
  )
  const hasLidarr = targets.some((t) => t.type === 'lidarr')

  const addOptions: TargetAddOptions = {
    // Profile/folder IDs come from each Lidarr target's own defaults.
    monitorOption: config.monitorOption,
  }

  let approved = 0
  let failed = 0

  for (const rec of eligible) {
    checkPipelineCancelled(signal)
    if (deps.canApprove && !(await deps.canApprove(rec.score))) continue
    const isAlbum = rec.kind === 'album'
    const recTargets = isAlbum ? albumTargets : addTargets
    if (
      isAlbum &&
      (!rec.recommendedReleaseGroupId?.trim() ||
        (hasAcquisitionTargets && albumTargets.length === 0))
    ) {
      await deps.updateRecommendationStatus(rec.id, 'add_failed', { targetActions: {} })
      failed++
      checkPipelineCancelled(signal)
      continue
    }

    if (recTargets.length === 0) {
      // No targets - mark as approved (discovery-only)
      await deps.updateRecommendationStatus(rec.id, 'approved', { targetActions: {} })
      approved++
      checkPipelineCancelled(signal)
      continue
    }

    if (deps.warmArtist && recTargets.some((t) => t.type === 'lidarr')) {
      await deps.warmArtist(rec.artist.mbid).catch(() => {})
    }

    checkPipelineCancelled(signal)
    const targetActions: Record<string, unknown> = {}
    let attempted = false
    let targetError: unknown
    let targetFailure: Error | undefined
    let anySuccess = false
    let lidarrResult: {
      success: boolean
      externalId?: number | string
      error?: string
    } | null = null

    for (const target of recTargets) {
      if (signal?.aborted) break
      const metadata = {
        targetType: target.type,
        artistName: rec.artist.name,
        mbid: rec.artist.mbid,
        action: isAlbum ? 'addAlbum' : 'add',
        ...(isAlbum ? { releaseGroupMbid: rec.recommendedReleaseGroupId } : {}),
      }
      let targetJobId: number | null = null
      try {
        targetJobId = deps.jobRecorder
          ? await deps.jobRecorder.start({ type: 'target', userId: deps.userId, metadata })
          : null
      } catch (error) {
        targetError = error
        break
      }

      if (signal?.aborted) {
        if (targetJobId != null && deps.jobRecorder) {
          try {
            await deps.jobRecorder.cancel(targetJobId)
          } catch (error) {
            targetError = error
          }
        }
        break
      }
      attempted = true
      const options = { ...addOptions, userId: deps.userId, recommendationId: rec.id }
      try {
        const result = isAlbum
          ? await target.addAlbum?.(
              {
                artistMbid: rec.artist.mbid,
                artistName: rec.artist.name,
                releaseGroupMbid: rec.recommendedReleaseGroupId as string,
              },
              options,
            )
          : await target.addArtist?.({ mbid: rec.artist.mbid, name: rec.artist.name }, options)

        if (!result) {
          if (targetJobId != null && deps.jobRecorder) {
            await deps.jobRecorder.complete(targetJobId, {
              metadata: { ...metadata, skipped: true },
            })
          }
          continue
        }

        targetActions[target.id] = targetAction(target, result, options)
        if (!result.success) targetFailure = new Error(result.error ?? 'Target returned failure')
        if (result.success) anySuccess = true
        if (target.type === 'lidarr') lidarrResult = result

        if (targetJobId != null && deps.jobRecorder) {
          if (result.success) {
            await deps.jobRecorder.complete(targetJobId, {
              metadata: {
                ...metadata,
                externalId: result.externalId,
              },
            })
          } else {
            await deps.jobRecorder.fail(targetJobId, result.error ?? 'Target returned failure')
          }
        }
      } catch (error) {
        const message = errMsg(error)
        const temporary =
          !targetActions[target.id] && target.type === 'lidarr' && isTemporaryLidarrFailure(message)
        if (!temporary) targetError = error
        targetActions[target.id] ??= {
          status: 'failed',
          error: errMsg(error),
        }
        if (temporary)
          targetActions[target.id] = targetAction(
            target,
            { success: false, targetType: target.type, targetId: 0, error: message },
            options,
          )
        if (targetJobId != null && deps.jobRecorder) {
          await recordFailureSafely(deps.jobRecorder, targetJobId, errMsg(error))
        }
        if (!temporary) break
      }
    }

    if (!attempted) {
      if (targetError) throw targetError
      checkPipelineCancelled(signal)
    }
    const extra: StatusUpdateExtra = { targetActions }
    if (lidarrResult) {
      if (!isAlbum && lidarrResult.externalId) {
        extra.lidarrArtistId = lidarrResult.externalId as number
      }
      if (lidarrResult.error) extra.lidarrError = lidarrResult.error
    }

    const lidarrSucceeded = lidarrResult?.success === true
    const lidarrFailed = hasLidarr && lidarrResult != null && !lidarrResult.success
    const finalStatus = hasWaitingAction(targetActions)
      ? 'waiting'
      : lidarrSucceeded
        ? 'added_to_lidarr'
        : lidarrFailed
          ? 'add_failed'
          : anySuccess
            ? 'approved'
            : 'add_failed'

    try {
      await deps.updateRecommendationStatus(rec.id, finalStatus, extra)
    } catch (error) {
      if (targetError)
        throw new AggregateError([targetError, error], 'Failed to persist target results')
      throw error
    }
    if (targetError) throw targetError
    if (signal?.aborted && targetFailure) throw targetFailure
    checkPipelineCancelled(signal)
    if (anySuccess || hasWaitingAction(targetActions)) approved++
    else failed++
  }

  return { approved, failed }
}
