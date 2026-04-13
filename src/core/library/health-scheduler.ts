import { Cron } from 'croner'

export type LibraryHealthSchedulerDeps = {
  intervalHours: number
  libraryHealth: {
    startScan: () => void
  }
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
  return new Cron(pattern, () => {
    try {
      deps.libraryHealth.startScan()
    } catch (err: unknown) {
      console.error('[library-health-scheduler] tick failed:', err)
    }
  })
}
