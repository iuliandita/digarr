import { BlockedTargetError, type GuardedInit, guardedFetch } from '@/core/net/guarded-fetch'
import { sleep } from '@/core/sleep'

const REDACTED_QUERY_VALUE = '[REDACTED]'
const SENSITIVE_QUERY_KEYS = new Set([
  'api_key',
  'apikey',
  'key',
  'token',
  'secret',
  'password',
  'auth',
  'access_token',
  'auth_token',
  'signature',
  'sig',
  'api_sig',
  'sk',
  // Subsonic auth params: 't' is md5(password+salt), 's' is the salt.
  // Logging both would expose an offline-brute-forceable credential.
  't',
  's',
])

type HttpClientConfig = {
  baseUrl: string
  headers?: Record<string, string>
  timeout?: number
  retries?: number
  skipTlsVerify?: boolean
  publicIpOnly?: boolean
  followRedirects?: boolean
  onRequest?: (method: string, url: string) => void
}

export type HttpRequestOptions = {
  retries?: number
  timeout?: number
}

export function createHttpClient(config: HttpClientConfig) {
  const {
    headers = {},
    timeout = 10_000,
    retries = 3,
    skipTlsVerify = false,
    publicIpOnly = false,
    followRedirects = false,
    onRequest,
  } = config
  const baseUrl = config.baseUrl.replace(/\/+$/, '')

  async function send(
    method: string,
    path: string,
    body?: unknown,
    options: HttpRequestOptions = {},
  ): Promise<{ status: number; text: string }> {
    const url = `${baseUrl}${path}`
    // Retrying a non-idempotent call (command, enqueue, add) can run it twice.
    const maxRetries = options.retries ?? (RETRYABLE_METHODS.has(method) ? retries : 0)
    const requestTimeout = options.timeout ?? timeout
    onRequest?.(method, url)

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), requestTimeout)
      let delayMs: number

      try {
        const init: GuardedInit = {
          method,
          headers: new Headers({
            'Content-Type':
              body instanceof URLSearchParams
                ? 'application/x-www-form-urlencoded'
                : 'application/json',
            ...headers,
          }),
          body:
            body instanceof URLSearchParams
              ? body.toString()
              : body
                ? JSON.stringify(body)
                : undefined,
          signal: controller.signal,
          ...(skipTlsVerify ? { tls: { rejectUnauthorized: false } } : {}),
        }
        // Private-network services (Lidarr, media servers on the LAN) are reached unguarded;
        // publicIpOnly clients get the resolve-and-pin guard on every hop.
        const res = publicIpOnly
          ? await guardedFetch(url, init, { maxRedirects: followRedirects ? MAX_REDIRECTS : 0 })
          : await fetch(url, {
              ...init,
              redirect: followRedirects ? 'follow' : 'manual',
            } as RequestInit)

        // The timer stays armed through the body read so a stalled body cannot hang the caller.
        if (res.ok) return { status: res.status, text: await res.text() }

        if (!followRedirects && res.status >= 300 && res.status < 400) {
          const location = res.headers.get('location')
          throw new HttpError(
            res.status,
            `Redirect blocked${location ? `: ${redactUrlForLog(location)}` : ''}`,
            url,
          )
        }

        const errorBody = await readResponseText(res)
        const retryable = res.status === 429 || res.status >= 500
        if (!retryable || attempt >= maxRetries) {
          throw new HttpError(res.status, errorBody, url)
        }
        delayMs =
          (res.status === 429 ? parseRetryAfterMs(res.headers.get('retry-after')) : null) ??
          backoffMs(attempt)
      } catch (err: unknown) {
        // A blocked target fails the same way on every attempt.
        if (err instanceof HttpError || err instanceof BlockedTargetError) throw err
        if (attempt >= maxRetries) {
          // A bare AbortError reads as "This operation was aborted", which tells
          // the user nothing about which budget they blew or that it is tunable.
          if (controller.signal.aborted) {
            throw new HttpTimeoutError(requestTimeout, method, url)
          }
          throw err
        }
        delayMs = backoffMs(attempt)
      } finally {
        clearTimeout(timer)
      }

      await sleep(delayMs)
    }

    throw new Error(`Request failed after ${maxRetries} retries: ${method} ${redactUrlForLog(url)}`)
  }

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    options: HttpRequestOptions = {},
  ): Promise<T> {
    const url = `${baseUrl}${path}`
    const { status, text } = await send(method, path, body, options)
    if (!text) {
      throw new HttpError(status, 'Expected JSON response body', url)
    }
    try {
      return JSON.parse(text) as T
    } catch {
      throw new HttpError(status, `Invalid JSON: ${text.slice(0, 200)}`, url)
    }
  }

  async function requestVoid(
    method: string,
    path: string,
    body?: unknown,
    options: HttpRequestOptions = {},
  ): Promise<void> {
    await send(method, path, body, options)
  }

  return {
    get: <T>(path: string, options?: HttpRequestOptions) =>
      request<T>('GET', path, undefined, options),
    post: <T>(path: string, body?: unknown, options?: HttpRequestOptions) =>
      request<T>('POST', path, body, options),
    postForm: <T>(path: string, body: URLSearchParams, options?: HttpRequestOptions) =>
      request<T>('POST', path, body, options),
    postVoid: (path: string, body?: unknown, options?: HttpRequestOptions) =>
      requestVoid('POST', path, body, options),
    put: <T>(path: string, body?: unknown, options?: HttpRequestOptions) =>
      request<T>('PUT', path, body, options),
    putVoid: (path: string, body?: unknown, options?: HttpRequestOptions) =>
      requestVoid('PUT', path, body, options),
    delete: (path: string, options?: HttpRequestOptions) =>
      requestVoid('DELETE', path, undefined, options),
  }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public body: string,
    url: string,
  ) {
    const redactedUrl = redactUrlForLog(url)
    super(`HTTP ${status} from ${redactedUrl}: ${body}`)
    this.name = 'HttpError'
    this.url = redactedUrl
  }

  public url: string
}

export class HttpTimeoutError extends Error {
  constructor(
    public timeoutMs: number,
    method: string,
    url: string,
  ) {
    const redactedUrl = redactUrlForLog(url)
    super(`Request timed out after ${timeoutMs}ms: ${method} ${redactedUrl}`)
    this.name = 'HttpTimeoutError'
    this.url = redactedUrl
  }

  public url: string
}

const RETRYABLE_METHODS = new Set(['GET', 'HEAD'])
const MAX_REDIRECTS = 5
const MAX_RETRY_AFTER_MS = 30_000

function backoffMs(attempt: number): number {
  return 2 ** attempt * 500
}

/** Retry-After as seconds or an HTTP-date, capped; null when absent or unparseable. */
function parseRetryAfterMs(raw: string | null): number | null {
  if (!raw) return null
  const value = raw.trim()
  let ms: number
  if (/^\d+$/.test(value)) ms = Number(value) * 1000
  else {
    const date = Date.parse(value)
    if (Number.isNaN(date)) return null
    ms = Math.max(0, date - Date.now())
  }
  return Math.min(ms, MAX_RETRY_AFTER_MS)
}

async function readResponseText(res: Response): Promise<string> {
  const text = await res.text()
  return text || '(empty response body)'
}

export function redactUrlForLog(url: string): string {
  try {
    const absolute = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(url)
    const parsed = absolute ? new URL(url) : new URL(url, 'http://redact.invalid')

    if (parsed.username) parsed.username = REDACTED_QUERY_VALUE
    if (parsed.password) parsed.password = REDACTED_QUERY_VALUE
    if (parsed.hash) parsed.hash = REDACTED_QUERY_VALUE

    const redactedParams = new URLSearchParams()

    for (const [key, value] of parsed.searchParams.entries()) {
      redactedParams.append(
        key,
        SENSITIVE_QUERY_KEYS.has(key.toLowerCase()) ? REDACTED_QUERY_VALUE : value,
      )
    }

    parsed.search = redactedParams.toString()
    const serialized = parsed.toString()
    return absolute ? serialized : serialized.replace('http://redact.invalid', '')
  } catch {
    return redactQueryStringFallback(url)
  }
}

function redactQueryStringFallback(url: string): string {
  const queryStart = url.indexOf('?')
  if (queryStart === -1) return url

  const hashStart = url.indexOf('#', queryStart)
  const prefix = url.slice(0, queryStart + 1)
  const query = url.slice(queryStart + 1, hashStart === -1 ? undefined : hashStart)
  const suffix = hashStart === -1 ? '' : url.slice(hashStart)

  const redactedQuery = query
    .split('&')
    .map((part) => {
      const equalsIndex = part.indexOf('=')
      if (equalsIndex === -1) return part

      const key = part.slice(0, equalsIndex).toLowerCase()
      if (!SENSITIVE_QUERY_KEYS.has(key)) return part

      return `${part.slice(0, equalsIndex + 1)}${REDACTED_QUERY_VALUE}`
    })
    .join('&')

  return `${prefix}${redactedQuery}${suffix}`
}
