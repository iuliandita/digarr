export const REJECTION_REASONS = [
  'already_own',
  'wrong_style',
  'not_interested',
  'tried_didnt_like',
  'not_right_now',
  'other',
] as const

export type RejectionReason = (typeof REJECTION_REASONS)[number]

const REJECTION_REASON_SET: ReadonlySet<string> = new Set(REJECTION_REASONS)

export function isValidRejectionReason(value: string): value is RejectionReason {
  return REJECTION_REASON_SET.has(value)
}
