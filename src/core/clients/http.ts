import * as dns from 'node:dns/promises'
import { isPrivateIp, isPrivateUrl } from '@/core/notifications'
import { getLookupHostname } from '@/core/validation'

const REDACTED_QUERY_VALUE = '[REDACTED]'
const SENSITIVE_QUERY_KEYS = new Set(['api_key', 'apikey', 'key', 'token', 'secret', 'password'])

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

export function createHttpClient(config: HttpClientConfig) {
  const {
    baseUrl,
    headers = {},
    timeout = 10_000,
    retries = 3,
    skipTlsVerify = false,
    publicIpOnly = false,
    followRedirects = false,
    onRequest,
  } = config

  async function send(method: string, path: string, body?: unknown): Promise<Response> {
    const url = `${baseUrl}${path}`
    onRequest?.(method, url)

    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeout)

      try {
        const prepared = await prepareRequest(
          url,
          {
            method,
            headers: {
              'Content-Type': 'application/json',
              ...headers,
            },
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal,
          },
          {
            publicIpOnly,
            followRedirects,
          },
        )

        const res = await fetch(prepared.url, {
          ...prepared.init,
          ...(skipTlsVerify ? { tls: { rejectUnauthorized: false } } : {}),
        } as RequestInit)

        clearTimeout(timer)
        if (res.ok) return res

        if (!followRedirects && res.status >= 300 && res.status < 400) {
          const location = res.headers.get('location')
          throw new HttpError(
            res.status,
            `Redirect blocked${location ? `: ${redactUrlForLog(location)}` : ''}`,
            url,
          )
        }

        const errorBody = await readResponseText(res)
        if (res.status >= 400 && res.status < 500) {
          throw new HttpError(res.status, errorBody, url)
        }
        if (attempt >= retries) {
          throw new HttpError(res.status, errorBody, url)
        }
      } catch (err: unknown) {
        clearTimeout(timer)
        if (err instanceof HttpError) {
          if (err.status >= 500 && attempt < retries) {
            await sleep(2 ** attempt * 500)
            continue
          }
          throw err
        }
        if (attempt >= retries) throw err
        await sleep(2 ** attempt * 500)
      }
    }

    throw new Error(`Request failed after ${retries} retries: ${method} ${redactUrlForLog(url)}`)
  }

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${baseUrl}${path}`
    const res = await send(method, path, body)
    const text = await res.text()
    if (!text) {
      throw new HttpError(res.status, 'Expected JSON response body', url)
    }
    try {
      return JSON.parse(text) as T
    } catch {
      throw new HttpError(res.status, `Invalid JSON: ${text.slice(0, 200)}`, url)
    }
  }

  async function requestVoid(method: string, path: string, body?: unknown): Promise<void> {
    await send(method, path, body)
  }

  return {
    get: <T>(path: string) => request<T>('GET', path),
    post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
    put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
    delete: (path: string) => requestVoid('DELETE', path),
  }
}

async function prepareRequest(
  url: string,
  init: RequestInit,
  options: { publicIpOnly: boolean; followRedirects: boolean },
): Promise<{ url: string; init: RequestInit }> {
  const headers = new Headers(init.headers)
  let fetchUrl = url

  if (options.publicIpOnly) {
    if (isPrivateUrl(url)) {
      throw new Error('URL points to a private/internal address')
    }

    const parsedUrl = new URL(url)
    const hostname = getLookupHostname(parsedUrl)
    const { address } = await dns.lookup(hostname)
    if (isPrivateIp(address)) {
      throw new Error('URL resolves to a private/internal IP')
    }

    if (parsedUrl.protocol === 'http:' && address !== hostname) {
      const pinnedUrl = new URL(url)
      pinnedUrl.hostname = address
      fetchUrl = pinnedUrl.toString()
      headers.set('Host', parsedUrl.host)
    }
  }

  return {
    url: fetchUrl,
    init: {
      ...init,
      headers,
      redirect: options.followRedirects ? 'follow' : 'manual',
    },
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function readResponseText(res: Response): Promise<string> {
  const text = await res.text()
  return text || '(empty response body)'
}

export function redactUrlForLog(url: string): string {
  try {
    const absolute = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(url)
    const parsed = absolute ? new URL(url) : new URL(url, 'http://redact.invalid')
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
