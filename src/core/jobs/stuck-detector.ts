import { Cron } from 'croner'
import { isMaintenance } from '@/core/ops/maintenance'
import type { JobRecorder } from './types'

export function startStuckDetector(recorder: JobRecorder): Cron {
  return new Cron('*/5 * * * *', async () => {
    if (isMaintenance()) {
      console.log('[stuck-detector] tick skipped: maintenance in progress')
      return
    }
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
