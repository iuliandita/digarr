import { Cron } from 'croner'
import type { SyncOrchestrator } from './sync'

export type LibrarySchedulerDeps = {
  intervalHours: number
  orchestrator: SyncOrchestrator
  listUserIds: () => Promise<number[]>
}

/**
 * Build a cron pattern from an integer-hours interval.
 *
 * - < 1h → fall back to every-5-minutes (defensive; settings stores integer hours)
 * - 1-23h → "at minute 0 of every N hours" (`0 * / N * * *`)
 * - >= 24h → capped to 23h (croner rejects step values >= 24 in the hours field)
 */
function buildCronPattern(intervalHours: number): string {
  if (intervalHours < 1) return '*/5 * * * *'
  const hours = Math.min(23, Math.round(intervalHours))
  return `0 */${hours} * * *`
}

/**
 * Background library sync scheduler. Joins the existing schedulers
 * (pipeline, subscription, playlist, stuck detector) in src/index.ts.
 *
 * Each tick:
 *  1. syncGlobal() once (handles Lidarr)
 *  2. syncForUser(uid) for each user (handles Plex/Jellyfin)
 *
 * Per-source coalescing in the orchestrator gracefully skips fresh sources,
 * so a tick is cheap when nothing is stale.
 *
 * The interval is captured at construction time; runtime settings changes
 * require a restart to take effect. This matches the other schedulers in the
 * codebase (SubscriptionScheduler, PlaylistScheduler).
 */
export function startLibrarySyncScheduler(deps: LibrarySchedulerDeps): Cron {
  const pattern = buildCronPattern(deps.intervalHours)
  console.log(
    `[library-sync-scheduler] started, interval=${deps.intervalHours}h, pattern="${pattern}"`,
  )
  const cron = new Cron(pattern, async () => {
    try {
      await deps.orchestrator.syncGlobal()
      const users = await deps.listUserIds()
      for (const uid of users) {
        await deps.orchestrator.syncForUser(uid)
      }
    } catch (err: unknown) {
      console.error('[library-sync-scheduler] tick failed:', err)
    }
  })
  return cron
}
