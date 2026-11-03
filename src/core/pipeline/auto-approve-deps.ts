import { type ApprovalPolicyUser, requiresApprovalRequest } from '@/core/approvals/policy'
import type { JobRecorder } from '@/core/jobs/types'
import type { ListRecommendationsResult } from '@/db/queries/recommendations'
import type { AutoApproveDeps } from './auto-approve'

const BATCH_PAGE_LIMIT = 1000

export function buildAutoApproveDeps(options: {
  userId?: number
  user: ApprovalPolicyUser | null
  listRecommendations: (filters: {
    batchId: number
    limit: number
  }) => Promise<Pick<ListRecommendationsResult, 'items'>>
  getEnabledTargets: AutoApproveDeps['getEnabledTargets']
  updateRecommendationStatus: AutoApproveDeps['updateRecommendationStatus']
  jobRecorder?: JobRecorder
  skyhookWarmer?: { warm: (mbid: string) => Promise<void> } | null
}): AutoApproveDeps {
  const { userId, user, skyhookWarmer } = options
  return {
    getRecommendationsByBatch: async (batchId) => {
      const result = await options.listRecommendations({ batchId, limit: BATCH_PAGE_LIMIT })
      return result.items.map((r) => ({
        id: r.id,
        score: r.score,
        status: r.status,
        kind: r.kind,
        recommendedReleaseGroupId: r.recommendedReleaseGroupId,
        artist: { mbid: r.artist.mbid, name: r.artist.name },
      }))
    },
    getEnabledTargets: options.getEnabledTargets,
    userId,
    jobRecorder: options.jobRecorder,
    ...(user && user.approvalPolicy !== 'direct'
      ? { canApprove: async (score: number) => !requiresApprovalRequest(user, score) }
      : {}),
    updateRecommendationStatus: options.updateRecommendationStatus,
    warmArtist: skyhookWarmer ? (mbid) => skyhookWarmer.warm(mbid) : undefined,
  }
}
