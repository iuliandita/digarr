export const REJECTION_REASONS = [
  'already_own',
  'wrong_style',
  'not_interested',
  'tried_didnt_like',
  'not_right_now',
  'other',
] as const

export type RejectionReason = (typeof REJECTION_REASONS)[number]
