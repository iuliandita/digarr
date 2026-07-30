import { redactSecrets } from '@/core/validation'

export type TokenExchangeError =
  | 'token_exchange_unreachable'
  | 'token_exchange_failed'
  | 'token_exchange_malformed'

export type TokenExchangeResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: TokenExchangeError }

export type TokenExchangeOptions = {
  /** Provider id, used only for log lines. */
  provider: string
  tokenUrl: string
  params: URLSearchParams
  /** `GET` sends the params as a query string (Deezer's documented flow). */
  method?: 'POST' | 'GET'
  basicAuth?: { clientId: string; clientSecret: string }
  /** Accept a form-encoded body when the provider does not always answer JSON. */
  allowFormResponse?: boolean
  timeoutMs?: number
}

async function readBody(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}

/**
 * POST (or GET) an authorization code to a provider's token endpoint and return
 * the parsed body. Every failure mode maps to one of the `oauth_error` codes the
 * settings page renders, so the caller only has to redirect.
 */
export async function exchangeAuthCode(
  options: TokenExchangeOptions,
): Promise<TokenExchangeResult> {
  const { provider, tokenUrl, params, method = 'POST', basicAuth, timeoutMs = 10_000 } = options

  const headers: Record<string, string> = {}
  if (method === 'POST') headers['Content-Type'] = 'application/x-www-form-urlencoded'
  if (basicAuth) {
    headers.Authorization = `Basic ${btoa(`${basicAuth.clientId}:${basicAuth.clientSecret}`)}`
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(method === 'GET' ? `${tokenUrl}?${params}` : tokenUrl, {
      method,
      headers,
      ...(method === 'POST' ? { body: params.toString() } : {}),
      signal: controller.signal,
    })
  } catch (err) {
    console.error(`${provider} token exchange request failed:`, err)
    return { ok: false, error: 'token_exchange_unreachable' }
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    // The upstream body can echo the credentials that were just posted, and is
    // the only diagnosable artifact when an exchange fails.
    const detail = redactSecrets(await readBody(res)).slice(0, 300)
    console.error(`${provider} token exchange failed: ${res.status} ${detail}`)
    return { ok: false, error: 'token_exchange_failed' }
  }

  const raw = await readBody(res)
  try {
    return { ok: true, data: JSON.parse(raw) as Record<string, unknown> }
  } catch (err) {
    if (options.allowFormResponse) {
      const parsed = new URLSearchParams(raw)
      return { ok: true, data: Object.fromEntries(parsed.entries()) }
    }
    console.error(`${provider} token exchange returned a non-JSON body:`, err)
    return { ok: false, error: 'token_exchange_malformed' }
  }
}
