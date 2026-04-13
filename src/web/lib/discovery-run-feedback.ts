import { getJob, type JobRun } from './api'

type WaitForDiscoveryRunCompletionOptions = {
  getJob?: (id: number) => Promise<JobRun>
  pollIntervalMs?: number
  maxAttempts?: number
  onCompleted?: (job: JobRun) => void
  onFailed?: (job: JobRun) => void
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
