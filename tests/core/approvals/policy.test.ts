import { describe, expect, it } from 'vitest'
import { requiresApprovalRequest } from '@/core/approvals/policy'

describe('approval policies', () => {
  it.each([
    [null, 0, false],
    [{ approvalPolicy: 'direct' }, 0, false],
    [{ approvalPolicy: 'request_only' }, 1, true],
    [{ approvalPolicy: 'auto_approve', approvalThreshold: 0.9 }, 0.89, true],
    [{ approvalPolicy: 'auto_approve', approvalThreshold: 0.9 }, 0.9, false],
    [{ approvalPolicy: 'auto_approve', approvalThreshold: null }, 0.79, true],
    [{ approvalPolicy: 'auto_approve', approvalThreshold: null }, 0.8, false],
    [{ approvalPolicy: 'auto_approve', approvalThreshold: 0.9 }, Number.NaN, true],
  ] as const)('requires request for %j at score %s: %s', (user, score, expected) => {
    expect(requiresApprovalRequest(user, score)).toBe(expected)
  })
})
