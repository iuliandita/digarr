import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { redactUrlForLog } from '../clients/http'
import {
  formatUrlHostname,
  getLookupHostname,
  isHttpUrl,
  isPrivateIp,
  isRfc1918,
  normalizeIp,
} from '../validation'

export type PostResult = { ok: boolean; status?: number; error?: string }
export type PostOptions = {
  allowPrivate?: boolean
  headers?: Record<string, string>
  timeoutMs?: number
  rawBody?: string
  redact?: (url: string) => string
}

function isIpLiteral(hostname: string): boolean {
  return isIP(hostname) !== 0
}

function blocksAddress(address: string, allowPrivate: boolean): boolean {
  if (!isPrivateIp(address)) return false
  if (allowPrivate && isRfc1918(address)) return false
  return true
}

export async function post(
  url: string,
  body: unknown,
  opts: PostOptions = {},
): Promise<PostResult> {
  const allowPrivate = opts.allowPrivate ?? false
  const redact = opts.redact ?? redactUrlForLog

  if (!isHttpUrl(url)) return { ok: false, error: 'URL must use http:// or https://' }

  let parsedUrl: URL
  let resolvedAddress: string
  try {
    parsedUrl = new URL(url)
    const hostname = getLookupHostname(parsedUrl)
    if (hostname === 'localhost') {
      return { ok: false, error: 'URL points to a blocked private/internal address' }
    }
    if (blocksAddress(hostname, allowPrivate)) {
      return { ok: false, error: 'URL points to a blocked private/internal address' }
    }
    const { address } = await lookup(hostname)
    if (blocksAddress(address, allowPrivate)) {
      return { ok: false, error: 'URL resolves to a blocked private/internal IP' }
    }
    resolvedAddress = address
  } catch {
    return { ok: false, error: 'URL hostname resolution failed' }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000)
  const safeUrl = redact(url)
  const fetchUrl = new URL(url)
  fetchUrl.hostname = formatUrlHostname(resolvedAddress)

  const fetchHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...opts.headers,
  }
  // Pin the resolved IP to prevent DNS rebinding between check and use.
  // HTTPS keeps the original hostname for SNI while connecting to the pinned IP.
  if (resolvedAddress !== parsedUrl.hostname || parsedUrl.protocol === 'https:') {
    fetchHeaders.Host = parsedUrl.host
  }

  const fetchInit: RequestInit & { tls?: { serverName: string } } = {
    method: 'POST',
    headers: fetchHeaders,
    body: opts.rawBody ?? JSON.stringify(body),
    signal: controller.signal,
    redirect: 'manual',
  }
  const normalizedHostname = normalizeIp(parsedUrl.hostname)
  if (parsedUrl.protocol === 'https:' && !isIpLiteral(normalizedHostname)) {
    fetchInit.tls = { serverName: normalizedHostname }
  }

  try {
    const res = await fetch(fetchUrl.toString(), fetchInit)
    if (!res.ok) {
      console.error(`POST to ${safeUrl} failed: HTTP ${res.status}`)
      return { ok: false, status: res.status, error: `HTTP ${res.status}` }
    }
    return { ok: true, status: res.status }
  } catch (err: unknown) {
    console.error(`POST to ${safeUrl} failed:`, err)
    return { ok: false, error: err instanceof Error ? err.message : 'request failed' }
  } finally {
    clearTimeout(timeout)
  }
}
