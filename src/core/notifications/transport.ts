import { redactUrlForLog } from '../clients/http'
import { BlockedTargetError, type GuardedInit, pinRequest } from '../net/guarded-fetch'
import { isHttpUrl, redactSecrets } from '../validation'

export type PostResult = { ok: boolean; status?: number; error?: string }
export type PostOptions = {
  allowPrivate?: boolean
  headers?: Record<string, string>
  timeoutMs?: number
  rawBody?: string
  redact?: (url: string) => string
}

function blockedMessage(err: unknown): string {
  if (err instanceof BlockedTargetError && err.reason === 'blocked_host') {
    return 'URL points to a blocked private/internal address'
  }
  if (err instanceof BlockedTargetError && err.reason === 'blocked_ip') {
    return 'URL resolves to a blocked private/internal IP'
  }
  return 'URL hostname resolution failed'
}

export async function post(
  url: string,
  body: unknown,
  opts: PostOptions = {},
): Promise<PostResult> {
  const redact = opts.redact ?? redactUrlForLog

  if (!isHttpUrl(url)) return { ok: false, error: 'URL must use http:// or https://' }

  const controller = new AbortController()
  const init: GuardedInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    body: opts.rawBody ?? JSON.stringify(body),
    signal: controller.signal,
  }
  let pinned: { url: string; init: GuardedInit }
  try {
    pinned = await pinRequest(url, init, opts.allowPrivate ? 'lan' : 'public')
  } catch (err) {
    return { ok: false, error: blockedMessage(err) }
  }

  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000)
  const safeUrl = redact(url)

  try {
    const res = await fetch(pinned.url, pinned.init as RequestInit)
    if (!res.ok) {
      console.error(`POST to ${safeUrl} failed: HTTP ${res.status}`)
      return { ok: false, status: res.status, error: `HTTP ${res.status}` }
    }
    return { ok: true, status: res.status }
  } catch (err: unknown) {
    const raw = err instanceof Error ? err.message : 'request failed'
    // Fetch errors can quote the URL, and webhook URLs carry their token in the path.
    const error = redactSecrets(
      raw.split(url).join(safeUrl).split(pinned.url).join(safeUrl),
      Object.entries(opts.headers ?? {})
        .filter(([name]) => !/^content-type$/i.test(name))
        .flatMap(([, value]) => [value, value.replace(/^(?:Bearer|Basic)\s+/i, '')]),
    )
    console.error(`POST to ${safeUrl} failed: ${error}`)
    return { ok: false, error }
  } finally {
    clearTimeout(timeout)
  }
}
