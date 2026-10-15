/** Thrown when a run is stopped cooperatively via the orchestrator's abort signal. */
export class PipelineCancelledError extends Error {
  constructor(message = 'Pipeline cancelled') {
    super(message)
    this.name = 'PipelineCancelledError'
  }
}

export function checkPipelineCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new PipelineCancelledError()
}
