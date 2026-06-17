import type { Pool } from 'pg'

const STARTUP_RETRY_INITIAL_MS = 1_000
const STARTUP_RETRY_MAX_MS = 30_000

// Postgres SQLSTATE codes that mean "the server is up but not ready to serve
// queries yet" (or the connection itself broke). All are safe to retry.
const RETRYABLE_PG_CODES = new Set([
  '57P03', // cannot_connect_now — still starting up / in recovery
  '57P02', // crash_shutdown
  '08000', // connection_exception
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08003', // connection_does_not_exist
  '08004', // sqlserver_rejected_establishment_of_sqlconnection
  '08006', // connection_failure
  '08007', // transaction_resolution_unknown
])

// Node-level network errors raised before Postgres ever responds (server not
// listening yet, DNS not resolved, etc.).
const RETRYABLE_NET_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
])

/**
 * True for connection failures that are expected while Postgres is still
 * starting up (57P03 "not yet accepting connections", ECONNREFUSED, etc.).
 * Permanent errors such as bad credentials (28P01) return false so they
 * propagate immediately instead of spinning behind the startup probe.
 */
export function isRetryableConnectionError(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false
  const code = (err as { code?: unknown }).code
  if (typeof code !== 'string') return false
  return RETRYABLE_PG_CODES.has(code) || RETRYABLE_NET_CODES.has(code)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export type WaitForDatabaseOptions = {
  /** Initial backoff delay in ms, doubled each attempt up to maxDelayMs. */
  initialDelayMs?: number
  /** Upper bound on the per-attempt backoff delay. */
  maxDelayMs?: number
  /**
   * Override the sleep between attempts. Tests inject a no-op to keep the
   * suite fast; production leaves it undefined for real setTimeout backoff.
   */
  sleepFn?: (ms: number) => Promise<void>
}

/**
 * Block at startup until Postgres accepts a connection and answers
 * `SELECT 1`. Retries transient connection failures (server still in
 * recovery, not listening yet, DNS flapping) with exponential backoff so a
 * slow-starting Postgres doesn't crash-loop the pod on kubelet restarts.
 *
 * Permanent errors (bad credentials, etc.) propagate immediately. This is
 * startup-only: runtime disconnects are recovered by the pool itself.
 */
export async function waitForDatabase(
  pool: Pool,
  options: WaitForDatabaseOptions = {},
): Promise<void> {
  const initialDelayMs = options.initialDelayMs ?? STARTUP_RETRY_INITIAL_MS
  const maxDelayMs = options.maxDelayMs ?? STARTUP_RETRY_MAX_MS
  const sleepFn = options.sleepFn ?? sleep

  let attempt = 0
  let delay = initialDelayMs
  for (;;) {
    attempt++
    try {
      await pool.query('SELECT 1')
      if (attempt > 1) console.log(`[db] connected after ${attempt} attempt(s)`)
      return
    } catch (err: unknown) {
      if (!isRetryableConnectionError(err)) throw err
      const code = (err as { code?: string }).code ?? 'n/a'
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(
        `[db] startup connect attempt ${attempt} failed (code=${code}): ${msg}; retrying in ${delay}ms`,
      )
      await sleepFn(delay)
      delay = Math.min(delay * 2, maxDelayMs)
    }
  }
}
