import type { JobRecorder } from './types'

/**
 * Best-effort job-failure recording.
 *
 * Marks the job failed via `recorder.fail` and swallows any error the recorder
 * itself throws, so a logging/DB hiccup never masks the original error the
 * caller is already handling (every call site uses this from a `catch` block
 * that goes on to rethrow or continue). `recorder.fail` already truncates long
 * messages to 2048 chars; this wrapper adds nothing beyond swallowing the
 * rejection. Callers that need to observe a recording failure (e.g. log it)
 * should call `recorder.fail` directly instead.
 */
export async function recordFailureSafely(
  recorder: JobRecorder,
  jobId: number,
  message: string,
): Promise<void> {
  await recorder.fail(jobId, message).catch(() => {})
}
