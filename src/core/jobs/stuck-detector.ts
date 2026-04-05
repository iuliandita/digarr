import { Cron } from 'croner'
import type { JobRecorder } from './types'

export function startStuckDetector(recorder: JobRecorder): Cron {
  return new Cron('*/5 * * * *', async () => {
    try {
      const count = await recorder.markStuck()
      if (count > 0) {
        console.warn(`[stuck-detector] Marked ${count} stuck job(s)`)
      }
    } catch (err: unknown) {
      console.error('[stuck-detector] Failed:', err)
    }
  })
}
