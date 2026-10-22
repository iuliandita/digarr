import type { JobRecorder } from '@/core/jobs/types'
import type { PipelineDeps, PipelineOrchestrator } from '@/core/pipeline/orchestrator'

type ScheduledPipelineDeps = Omit<PipelineDeps, 'jobRecorder' | 'trigger' | 'userId'>

interface ScheduledPipelineRunnerOptions {
  orchestrator: Pick<PipelineOrchestrator, 'enqueue'>
  jobRecorder: JobRecorder
  listUsers: () => Promise<Array<{ id: number; isAdmin: boolean }>>
  /** Builds the per-user context (connections, preferences, auto-approve) a manual run gets. */
  buildPipelineDeps: (userId: number) => Promise<ScheduledPipelineDeps | null>
}

export function createScheduledPipelineRunner(options: ScheduledPipelineRunnerOptions) {
  const { orchestrator, jobRecorder, listUsers, buildPipelineDeps } = options
  return async (userId?: number): Promise<void> => {
    let resolvedUserId = userId
    if (resolvedUserId === undefined) {
      const allUsers = await listUsers()
      const admin = allUsers.find((u) => u.isAdmin) ?? allUsers[0]
      resolvedUserId = admin?.id
    }
    if (resolvedUserId === undefined) return
    const pipelineDeps = await buildPipelineDeps(resolvedUserId)
    if (!pipelineDeps) return
    // Queue behind an in-flight scan like Run Scan does, instead of dropping this tick.
    const result = orchestrator.enqueue({
      ...pipelineDeps,
      userId: resolvedUserId,
      jobRecorder,
      trigger: 'scheduled',
    })
    if (result.status !== 'started') {
      console.log(`[scheduler] scheduled scan ${result.status} (position ${result.position})`)
    }
  }
}
