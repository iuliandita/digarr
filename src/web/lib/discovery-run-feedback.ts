import type { MessageKey } from '@/core/i18n/messages/types'
import { sleep } from '@/core/sleep'
import { getJob, type JobRun, type triggerPipeline } from './api'

export function scanStartedMessage(
  t: (key: MessageKey) => string,
  res: Awaited<ReturnType<typeof triggerPipeline>>,
): string {
  if (res.status === 'duplicate') return t('discover.scanAlreadyRunning')
  if (res.queued) return t('discover.scanQueued').replace('{0}', String(res.position ?? 0))
  return t('discover.scanStarted')
}

type WaitForDiscoveryRunCompletionOptions = {
  getJob?: (id: number) => Promise<JobRun>
  pollIntervalMs?: number
  maxAttempts?: number
  onCompleted?: (job: JobRun) => void
  onFailed?: (job: JobRun) => void
}

export async function waitForDiscoveryRunCompletion(
  jobId: number,
  {
    getJob: loadJob = getJob,
    pollIntervalMs = 1500,
    maxAttempts = 10,
    onCompleted,
    onFailed,
  }: WaitForDiscoveryRunCompletionOptions = {},
): Promise<JobRun | null> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0) {
      await sleep(pollIntervalMs)
    }

    try {
      const job = await loadJob(jobId)
      if (job.status === 'completed') {
        onCompleted?.(job)
        return job
      }

      if (job.status === 'failed' || job.status === 'stuck') {
        onFailed?.(job)
        return job
      }
    } catch {
      return null
    }
  }

  return null
}
