import type { DestinationTarget, TargetAddOptions, TargetResult } from './types'

const MINUTE = 60_000
export const LIDARR_RETRY_WINDOW = 24 * 60 * MINUTE
const BACKOFF = [5, 15, 60, 180]

export function isTemporaryLidarrFailure(error: string): boolean {
  const status = /(?:HTTP|status(?: code)?|returned)\s*[:=]?\s*(\d{3})\b/i.exec(error)?.[1]
  if (status === '408' || status === '429') return true
  if (status && Number(status) >= 500 && Number(status) < 600) return true
  if (status && Number(status) >= 400 && Number(status) < 500) return false
  if (
    /already exists|validation|(?:quality|metadata) profile .*not found|root folder .*not found|invalid (?:quality|metadata|root)|unauthorized|forbidden/i.test(
      error,
    )
  )
    return false
  return Boolean(
    /timeout|timed out|ETIMEDOUT|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENOTFOUND|EAI_AGAIN|fetch failed|unable to connect|connection (?:refused|reset)|SkyHook|album not found in Lidarr after adding artist|metadata (?:server|lookup)|failed to (?:load|fetch|retrieve) (?:artist|album) (?:metadata|from)/i.test(
      error,
    ),
  )
}

export type WaitingAction = {
  status: 'waiting'
  error?: string
  retry: {
    startedAt: string
    nextAttemptAt: string
    attempts: number
    options: TargetAddOptions
  }
}

export function isWaitingAction(value: unknown): value is WaitingAction {
  return hasRetryState(value) && value.status === 'waiting'
}

export function hasRetryState(
  value: unknown,
): value is Omit<WaitingAction, 'status'> & { status: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    typeof value.status === 'string' &&
    'retry' in value &&
    typeof value.retry === 'object' &&
    value.retry !== null &&
    'startedAt' in value.retry &&
    typeof value.retry.startedAt === 'string' &&
    Number.isFinite(Date.parse(value.retry.startedAt)) &&
    'nextAttemptAt' in value.retry &&
    typeof value.retry.nextAttemptAt === 'string' &&
    Number.isFinite(Date.parse(value.retry.nextAttemptAt)) &&
    'attempts' in value.retry &&
    typeof value.retry.attempts === 'number' &&
    'options' in value.retry &&
    typeof value.retry.options === 'object' &&
    value.retry.options !== null
  )
}

export function targetAction(
  target: Pick<DestinationTarget, 'type'>,
  result: TargetResult,
  options: TargetAddOptions,
  prior?: WaitingAction,
  now = Date.now(),
) {
  if (target.type === 'lidarr' && !result.success && isTemporaryLidarrFailure(result.error ?? '')) {
    const startedAt = prior?.retry.startedAt ?? new Date(now).toISOString()
    const attempts = (prior?.retry.attempts ?? 0) + 1
    return {
      status: 'waiting' as const,
      error: result.error,
      retry: {
        startedAt,
        attempts,
        nextAttemptAt: new Date(
          Math.min(
            now + (BACKOFF[Math.min(attempts - 1, BACKOFF.length - 1)] ?? 180) * MINUTE,
            Date.parse(startedAt) + LIDARR_RETRY_WINDOW,
          ),
        ).toISOString(),
        options,
      },
    }
  }
  return {
    status: result.success
      ? target.type === 'slskd'
        ? ('queued' as const)
        : ('added' as const)
      : ('failed' as const),
    externalId: result.externalId,
    error: result.error,
    ...(result.warning ? { warning: result.warning } : {}),
  }
}

export function hasWaitingAction(actions: Record<string, unknown>): boolean {
  return Object.values(actions).some(isWaitingAction)
}
