export type JobType = 'pipeline' | 'quick_discover' | 'subscription' | 'target' | 'playlist'
export type JobStatus = 'running' | 'completed' | 'failed' | 'stuck'
export type SourceStatus = 'ok' | 'error' | 'skipped'

export type SourceResult = {
  status: SourceStatus
  artists?: number
  ms?: number
  error?: string
  reason?: string
}

export type JobRunRow = {
  id: number
  type: string
  status: string
  userId: number | null
  startedAt: Date
  completedAt: Date | null
  durationMs: number | null
  error: string | null
  metadata: Record<string, unknown>
  sourceResults: Record<string, SourceResult> | null
  subscriptionId: number | null
  batchId: number | null
}

export type StartJobParams = {
  type: JobType
  userId?: number
  subscriptionId?: number
  metadata?: Record<string, unknown>
}

export type CompleteJobParams = {
  metadata?: Record<string, unknown>
  sourceResults?: Record<string, SourceResult>
  batchId?: number
}

export interface JobRecorder {
  start(params: StartJobParams): Promise<number>
  complete(jobId: number, params?: CompleteJobParams): Promise<void>
  fail(jobId: number, error: string): Promise<void>
  markStuck(): Promise<number>
}
