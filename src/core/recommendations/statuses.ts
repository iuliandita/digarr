export const VALID_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'added_to_lidarr',
  'add_failed',
  'duplicate',
  'queued',
] as const

export type ValidStatus = (typeof VALID_STATUSES)[number]

const VALID_SET: ReadonlySet<string> = new Set(VALID_STATUSES)

export function isValidStatus(value: string): value is ValidStatus {
  return VALID_SET.has(value)
}

/** Split a comma-separated status filter, trim, and drop unknown values. */
export function parseStatusFilter(raw: string): ValidStatus[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is ValidStatus => s.length > 0 && isValidStatus(s))
}
