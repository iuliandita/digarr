import pRetry, { AbortError } from 'p-retry'

export type RetriableFetchOptions = {
  /** Max retry attempts on top of the initial call. */
  retries?: number
  /** Exponential backoff base multiplier. */
  factor?: number
  /** Initial delay in ms (doubled each attempt by `factor`). */
  minTimeout?: number
  /** Upper bound on per-attempt delay. */
  maxTimeout?: number
  /**
   * Optional label recorded in the returned metadata so callers can include
   * provider context in job logs without re-implementing the retry accounting.
   */
  providerLabel?: string
  /**
   * If set, invoked with the final AbortController just before the AbortError
   * path is taken. Unused by current callers but keeps the API flexible.
   */
  onAbort?: () => void
}

export type RetryAttemptMetadata = {
  attempts: number
  lastStatus?: number
  lastRetryAfterSeconds?: number | null
}

const DEFAULTS: Required<Pick<RetriableFetchOptions, 'retries' | 'factor' | 'minTimeout'>> = {
  retries: 3,
  factor: 2,
  minTimeout: 1000,
}

/**
 * Wrap `fetch` with retry + exponential backoff that honours upstream
 * `Retry-After` headers. 4xx responses other than 429 raise an AbortError so
 * the retry loop stops immediately — there is nothing the retry can do about a
 * bad API key or a malformed request.
 *
 * Returns the successful `Response`; the caller still owns body parsing and
 * downstream error mapping.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: RetriableFetchOptions = {},
): Promise<Response> {
  const retries = options.retries ?? DEFAULTS.retries
  const factor = options.factor ?? DEFAULTS.factor
  const minTimeout = options.minTimeout ?? DEFAULTS.minTimeout
  const maxTimeout = options.maxTimeout

  return pRetry(
    async () => {
      let res: Response
      try {
        res = await fetch(url, init)
      } catch (err) {
        // Caller-side AbortController (timeout/cancellation) must not loop;
        // re-raise as AbortError so p-retry bails immediately.
        if (isAbortError(err)) {
          throw new AbortError((err as Error).message || 'aborted')
        }
        // Transient network errors bubble up and p-retry will retry them.
        throw err instanceof Error ? err : new Error(String(err))
      }

      if (res.status === 429) {
        const retryAfter = parseRetryAfter(res.headers.get('retry-after'))
        if (retryAfter && retryAfter > 0) {
          // Consume any pending body to avoid leaked connections.
          await res.arrayBuffer().catch(() => undefined)
          await delay(Math.min(retryAfter * 1000, maxTimeout ?? retryAfter * 1000))
        }
        throw new Error(`rate limited (${res.status})`)
      }

      if (res.status >= 500 && res.status <= 599) {
        const snippet = await errorBodySnippet(res)
        throw new Error(`upstream ${res.status}${snippet ? `: ${snippet}` : ''}`)
      }

      if (!res.ok) {
        // 4xx (not 429): give up, but keep the body - a bare status code
        // ("client error 404") gives users nothing to act on, while provider
        // bodies name the missing model or malformed field.
        const snippet = await errorBodySnippet(res)
        throw new AbortError(`client error ${res.status}${snippet ? `: ${snippet}` : ''}`)
      }

      return res
    },
    { retries, factor, minTimeout, ...(maxTimeout ? { maxTimeout } : {}) },
  )
}

/**
 * `Retry-After` is either a non-negative integer (seconds) or an HTTP-date.
 * We only handle the integer form - HTTP-dates are rare for API providers and
 * we fall back to the exponential backoff when we cannot parse.
 */
function parseRetryAfter(raw: string | null): number | null {
  if (!raw) return null
  const seconds = Number.parseInt(raw, 10)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds
  return null
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Read an error response body as a single-line snippet, capped for logs.
 * Snippets end up in thrown error messages that routes may echo to clients,
 * so credential-shaped substrings are redacted first.
 */
async function errorBodySnippet(res: Response): Promise<string> {
  const text = await res.text().catch(() => '')
  return redactSecrets(text.replace(/\s+/g, ' ').trim()).slice(0, 200)
}

export function redactSecrets(text: string): string {
  return text
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [redacted]')
    .replace(/([?&](?:api_?key|key|token)=)[^&\s"']+/gi, '$1[redacted]')
    .replace(/\bAIza[0-9A-Za-z_-]{30,}\b/g, '[redacted]')
    .replace(/\/\/([^/\s:@]+):([^@\s/]+)@/g, '//$1:[redacted]@')
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const name = (err as { name?: unknown }).name
  return name === 'AbortError' || name === 'TimeoutError'
}

export { AbortError }
