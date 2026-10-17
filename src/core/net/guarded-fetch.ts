import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import {
  errMsg,
  formatUrlHostname,
  getLookupHostname,
  isPrivateIp,
  isPrivateUrl,
  isRfc1918,
} from '@/core/validation'

/**
 * `public` blocks every private, loopback, link-local/metadata, CGNAT and reserved range.
 * `lan` additionally allows RFC 1918 hosts (self-hosted notification targets); loopback,
 * link-local/metadata and CGNAT stay blocked.
 */
export type TargetPolicy = 'public' | 'lan'

export type BlockReason =
  | 'unsupported_protocol'
  | 'blocked_host'
  | 'blocked_ip'
  | 'resolution_failed'
  | 'too_many_redirects'

export class BlockedTargetError extends Error {
  constructor(
    public readonly reason: BlockReason,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'BlockedTargetError'
  }
}

export type GuardedInit = RequestInit & {
  tls?: { serverName?: string; rejectUnauthorized?: boolean }
}

function isBlocked(address: string, policy: TargetPolicy): boolean {
  if (!isPrivateIp(address)) return false
  return !(policy === 'lan' && isRfc1918(address))
}

/**
 * Resolves the host, rejects blocked addresses, and pins the request to the resolved IP so
 * a second lookup inside fetch() cannot rebind to a private address. HTTPS keeps the
 * original hostname for SNI and certificate checks. Redirects are never followed here.
 */
export async function pinRequest(
  url: string,
  init: GuardedInit = {},
  policy: TargetPolicy = 'public',
): Promise<{ url: string; init: GuardedInit }> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BlockedTargetError('unsupported_protocol', 'URL must use http:// or https://')
  }
  const hostname = getLookupHostname(parsed)
  // isPrivateUrl also rejects `localhost`, which `lan` never allows.
  if (isPrivateUrl(url) && !(policy === 'lan' && isRfc1918(hostname))) {
    throw new BlockedTargetError('blocked_host', 'URL points to a private/internal address')
  }

  let address: string
  try {
    ;({ address } = await lookup(hostname))
  } catch (err) {
    throw new BlockedTargetError('resolution_failed', errMsg(err), { cause: err })
  }
  if (isBlocked(address, policy)) {
    throw new BlockedTargetError('blocked_ip', 'URL resolves to a private/internal IP')
  }

  const headers = new Headers(init.headers)
  const tls = { ...init.tls }
  let fetchUrl = url
  if (address !== hostname) {
    const pinned = new URL(url)
    pinned.hostname = formatUrlHostname(address)
    fetchUrl = pinned.toString()
    headers.set('Host', parsed.host)
    if (parsed.protocol === 'https:' && isIP(hostname) === 0) tls.serverName = hostname
  }

  return {
    url: fetchUrl,
    init: {
      ...init,
      headers,
      redirect: 'manual',
      ...(Object.keys(tls).length > 0 ? { tls } : {}),
    },
  }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

function redirectInit(init: GuardedInit, status: number, crossOrigin: boolean): GuardedInit {
  const headers = new Headers(init.headers)
  let method = (init.method ?? 'GET').toUpperCase()
  let body = init.body
  if (
    (status === 303 && method !== 'HEAD') ||
    ((status === 301 || status === 302) && method === 'POST')
  ) {
    method = 'GET'
    body = undefined
    headers.delete('content-type')
    headers.delete('content-length')
  }
  if (crossOrigin) {
    headers.delete('authorization')
    headers.delete('proxy-authorization')
    headers.delete('cookie')
  }
  return { ...init, method, body, headers }
}

export type GuardedFetchOptions = {
  policy?: TargetPolicy
  /** 0 returns the 3xx response to the caller unfollowed. */
  maxRedirects?: number
}

/** `pinRequest` + fetch, re-resolving and re-checking every redirect hop. */
export async function guardedFetch(
  url: string,
  init: GuardedInit = {},
  { policy = 'public', maxRedirects = 0 }: GuardedFetchOptions = {},
): Promise<Response> {
  let target = url
  let current = init
  for (let hop = 0; ; hop++) {
    const pinned = await pinRequest(target, current, policy)
    const res = await fetch(pinned.url, pinned.init as RequestInit)
    const location = res.headers.get('location')
    if (maxRedirects === 0 || !REDIRECT_STATUSES.has(res.status) || !location) return res
    await res.body?.cancel()
    if (hop >= maxRedirects) {
      throw new BlockedTargetError('too_many_redirects', `Too many redirects (max ${maxRedirects})`)
    }
    const next = new URL(location, target)
    current = redirectInit(current, res.status, next.origin !== new URL(target).origin)
    target = next.toString()
  }
}
