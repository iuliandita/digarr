import { ApiError, quickDiscover } from './api'

export type MoodAddStatus = 'queued' | 'sending' | 'added'
export type MoodAddFailure = 'rate-limited' | 'pipeline-running' | 'other'

type Handlers = {
  onAdded: () => void
  onFailed: (reason: MoodAddFailure, error: unknown) => void
}

type Job = Handlers & { artistName: string; attempts: number }

export const MAX_ATTEMPTS = 8
export const PIPELINE_RETRY_MS = 15_000
const MAX_RETRY_AFTER_S = 90

// Module-level so queued adds keep going when the mood bar unmounts or re-renders.
export function createMoodAddQueue(send: (artistName: string) => Promise<unknown>) {
  const statuses = new Map<string, MoodAddStatus>()
  const jobs: Job[] = []
  const listeners = new Set<() => void>()
  let snapshot: ReadonlyMap<string, MoodAddStatus> = new Map()
  let running = false

  function setStatus(artistName: string, status: MoodAddStatus | null) {
    if (status) statuses.set(artistName, status)
    else statuses.delete(artistName)
    snapshot = new Map(statuses)
    for (const l of listeners) l()
  }

  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

  async function attempt(job: Job): Promise<void> {
    for (;;) {
      job.attempts++
      setStatus(job.artistName, 'sending')
      let reason: MoodAddFailure
      let waitMs: number
      try {
        await send(job.artistName)
        setStatus(job.artistName, 'added')
        job.onAdded()
        return
      } catch (err) {
        if (err instanceof ApiError && err.status === 429) {
          reason = 'rate-limited'
          const seconds = Math.min(Math.max(err.retryAfter ?? 60, 1), MAX_RETRY_AFTER_S)
          waitMs = seconds * 1000
        } else if (err instanceof ApiError && err.status === 409) {
          reason = 'pipeline-running'
          waitMs = PIPELINE_RETRY_MS
        } else {
          setStatus(job.artistName, null)
          job.onFailed('other', err)
          return
        }
        if (job.attempts >= MAX_ATTEMPTS) {
          setStatus(job.artistName, null)
          job.onFailed(reason, err)
          return
        }
      }
      setStatus(job.artistName, 'queued')
      await sleep(waitMs)
    }
  }

  async function drain() {
    if (running) return
    running = true
    try {
      for (let job = jobs.shift(); job; job = jobs.shift()) await attempt(job)
    } finally {
      running = false
    }
  }

  return {
    enqueue(artistName: string, handlers: Handlers): boolean {
      if (statuses.has(artistName)) return false
      setStatus(artistName, 'queued')
      jobs.push({ artistName, attempts: 0, ...handlers })
      void drain()
      return true
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: () => snapshot,
  }
}

export const moodAddQueue = createMoodAddQueue((artistName) => quickDiscover(artistName))
