type HttpClientConfig = {
  baseUrl: string
  headers?: Record<string, string>
  timeout?: number
  retries?: number
  skipTlsVerify?: boolean
  onRequest?: (method: string, url: string) => void
}

export function createHttpClient(config: HttpClientConfig) {
  const {
    baseUrl,
    headers = {},
    timeout = 10_000,
    retries = 3,
    skipTlsVerify = false,
    onRequest,
  } = config

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${baseUrl}${path}`
    onRequest?.(method, url)

    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeout)

      try {
        const res = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...headers,
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
          ...(skipTlsVerify ? { tls: { rejectUnauthorized: false } } : {}),
        } as RequestInit)

        clearTimeout(timer)

        if (res.ok) {
          const text = await res.text()
          if (!text) return undefined as T
          try {
            return JSON.parse(text) as T
          } catch {
            throw new HttpError(res.status, `Invalid JSON: ${text.slice(0, 200)}`, url)
          }
        }

        if (res.status >= 500 && attempt < retries) {
          await sleep(2 ** attempt * 500)
          continue
        }

        throw new HttpError(res.status, await res.text(), url)
      } catch (err: unknown) {
        clearTimeout(timer)
        if (err instanceof HttpError) throw err
        if (attempt >= retries) throw err
        await sleep(2 ** attempt * 500)
      }
    }

    throw new Error(`Request failed after ${retries} retries: ${method} ${url}`)
  }

  return {
    get: <T>(path: string) => request<T>('GET', path),
    post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
    put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
    delete: <T>(path: string) => request<T>('DELETE', path),
  }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public body: string,
    public url: string,
  ) {
    super(`HTTP ${status} from ${url}: ${body}`)
    this.name = 'HttpError'
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
