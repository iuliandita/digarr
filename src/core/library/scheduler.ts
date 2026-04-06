import { Cron } from 'croner'
import type { SyncOrchestrator } from './sync'

export type LibrarySchedulerDeps = {
  intervalHours: number
  orchestrator: SyncOrchestrator
  listUserIds: () => Promise<number[]>
}

/**
 * Background library sync scheduler. Joins the existing schedulers
 * (pipeline, subscription, playlist, stuck detector) in src/index.ts.
 *
 * Each tick:
 *  1. syncGlobal() once (handles Lidarr)
 *  2. syncForUser(uid) for each user (handles Plex/Jellyfin/Emby)
 *
 * Per-source coalescing in the orchestrator gracefully skips fresh sources,
 * so a tick is cheap when nothing is stale.
 */
export function startLibrarySyncScheduler(deps: LibrarySchedulerDeps): Cron {
  const intervalMinutes = Math.max(5, deps.intervalHours * 60)
  const cron = new Cron(`*/${intervalMinutes} * * * *`, async () => {
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
