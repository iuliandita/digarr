import type { RecommendationWithArtist, StatusUpdateExtra } from '@/db/queries/recommendations'
import type { SlskdJobRow } from '@/db/queries/slskd-jobs'
import { deriveStatusFromActions } from './action-status'
import { hasWaitingAction } from './lidarr-retry'
import { withApprovalLock } from './lidarr-retry-worker'

type SlskdRecommendationDeps = {
  getRecommendation: (id: number) => Promise<RecommendationWithArtist | null>
  listJobs: (id: number, targetId: number) => Promise<Pick<SlskdJobRow, 'state' | 'lastError'>[]>
  update: (id: number, status: string, extra: StatusUpdateExtra) => Promise<void>
}

export async function updateSlskdRecommendationAction(
  deps: SlskdRecommendationDeps,
  recommendationId: number,
  targetId: number,
  status: string,
  error?: string,
) {
  return withApprovalLock(recommendationId, async () => {
    const recommendation = await deps.getRecommendation(recommendationId)
    if (!recommendation) {
      return
    }

    const jobs = await deps.listJobs(recommendationId, targetId)
    const activeStates = new Set([
      'pending',
      'searching',
      'queued',
      'downloading',
      'import_pending',
    ])
    const activeJobs = jobs.filter((job) => activeStates.has(job.state))
    const completedJobs = jobs.filter((job) => job.state === 'completed')
    const failedJobs = jobs.filter((job) => job.state === 'failed')
    const needsReview = failedJobs.some(
      (job) => job.lastError === 'slskd search needs manual review',
    )

    let nextActionStatus = status
    let nextActionError = error

    if (activeJobs.some((job) => job.state === 'import_pending')) {
      nextActionStatus = 'import_pending'
      nextActionError = undefined
    } else if (activeJobs.some((job) => job.state === 'downloading')) {
      nextActionStatus = 'downloading'
      nextActionError = undefined
    } else if (activeJobs.length > 0) {
      nextActionStatus = 'queued'
      nextActionError = undefined
    } else if (completedJobs.length > 0) {
      nextActionStatus = 'added'
      nextActionError = undefined
    } else if (needsReview) {
      nextActionStatus = 'needs_review'
      nextActionError = undefined
    } else if (failedJobs.length > 0) {
      nextActionStatus = 'failed'
      nextActionError =
        nextActionError ??
        failedJobs.find((job) => job.lastError && job.lastError.length > 0)?.lastError ??
        undefined
    }

    const targetActions = {
      ...(((recommendation.targetActions as Record<string, unknown> | null) ?? {}) as Record<
        string,
        unknown
      >),
      [`slskd-${targetId}`]: nextActionError
        ? { status: nextActionStatus, error: nextActionError }
        : { status: nextActionStatus },
    }

    const nextStatus =
      nextActionStatus === 'failed'
        ? deriveStatusFromActions(targetActions, recommendation.lidarrArtistId ?? undefined)
        : recommendation.status

    await deps.update(recommendationId, nextStatus, {
      targetActions,
      preserveActedOnAt: hasWaitingAction(targetActions),
    })
  })
}
