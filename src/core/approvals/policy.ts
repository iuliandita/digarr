import { DEFAULT_PREFERENCES } from '@/db/schema'

export type ApprovalPolicyUser = {
  approvalPolicy?: string
  approvalThreshold?: number | null
}

export function requiresApprovalRequest(user: ApprovalPolicyUser | null, score: number): boolean {
  if (user?.approvalPolicy === 'request_only') return true
  if (user?.approvalPolicy !== 'auto_approve') return false
  const threshold = user.approvalThreshold ?? DEFAULT_PREFERENCES.autoApproveThreshold ?? 0.8
  return !Number.isFinite(score) || score < threshold
}
