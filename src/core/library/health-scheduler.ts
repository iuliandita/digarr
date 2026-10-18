import { Cron } from 'croner'
import { isMaintenance } from '@/core/ops/maintenance'
import { buildCronPattern } from './scheduler'

export type LibraryHealthSchedulerDeps = {
  intervalHours: number
  libraryHealth: {
    startScan: () => void
  }
  // Scheduled scans are Lidarr-only; discovery-only installs skip them instead of failing every tick.
  isConfigured: () => Promise<boolean>
}

export function startLibraryHealthScheduler(deps: LibraryHealthSchedulerDeps): Cron {
  const pattern = buildCronPattern(deps.intervalHours)
  console.log(
    `[library-health-scheduler] started, interval=${deps.intervalHours}h, pattern="${pattern}"`,
  )
  return new Cron(pattern, async () => {
    if (isMaintenance()) {
      console.log('[library-health-scheduler] tick skipped: maintenance in progress')
      return
    }
    try {
      if (!(await deps.isConfigured())) return
      deps.libraryHealth.startScan()
    } catch (err: unknown) {
      console.error('[library-health-scheduler] tick failed:', err)
    }
  })
}
