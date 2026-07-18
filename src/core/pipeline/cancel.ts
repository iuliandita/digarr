/** Thrown when a run is stopped cooperatively via the orchestrator's abort signal. */
export class PipelineCancelledError extends Error {
  constructor(message = 'Pipeline cancelled') {
    super(message)
    this.name = 'PipelineCancelledError'
  }
}

/**
 * Grace window before a cancelled-but-wedged run is force-reset. Cooperative
 * abort normally lands within one request timeout (~10s); this backstop only
 * fires if the run ignores the signal entirely.
 */
export const FORCE_RESET_GRACE_MS = 15_000
