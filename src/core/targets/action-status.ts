import { hasWaitingAction } from './lidarr-retry'

/** Derive status from all targets so a failed attempt cannot hide another success. */
export function deriveStatusFromActions(
  actions: Record<string, unknown>,
  lidarrArtistId: number | string | undefined,
): string {
  const entries = Object.entries(actions) as [string, { status?: string } | null][]
  if (
    lidarrArtistId ||
    entries.some(([id, action]) => id.startsWith('lidarr-') && action?.status === 'added')
  ) {
    return 'added_to_lidarr'
  }
  if (entries.some(([, action]) => action?.status === 'added' || action?.status === 'queued')) {
    return 'approved'
  }
  return hasWaitingAction(actions) ? 'waiting' : 'add_failed'
}
