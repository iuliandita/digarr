import { Cron } from 'croner'
import { isMaintenance } from '@/core/ops/maintenance'

export type LibraryHealthSchedulerDeps = {
  intervalHours: number
  libraryHealth: {
    startScan: () => void
  }
  // Scheduled scans are Lidarr-only; discovery-only installs skip them instead of failing every tick.
  isConfigured: () => Promise<boolean>
}

function buildCronPattern(intervalHours: number): string {
  if (intervalHours < 1) return '*/5 * * * *'
  const hours = Math.min(23, Math.round(intervalHours))
  return `0 */${hours} * * *`
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
