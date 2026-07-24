import { createHash, randomBytes } from 'node:crypto'
import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { PENDING_OAUTH_TTL_MS } from '@/db/queries/oauth-pending'
import { browserCookieSecure } from '@/server/middleware/session-cookie'
import type { HonoEnv } from '@/server/types'

const COOKIE_PREFIX = 'digarr_oauth_'

function callbackPath(provider: string): string {
  return `/api/v1/auth/oauth/${provider}/callback`
}

export function oauthTransactionCookieName(provider: string, state: string): string {
  const suffix = createHash('sha256')
    .update(`${provider}:${state}`)
    .digest('base64url')
    .slice(0, 22)
  return `${COOKIE_PREFIX}${suffix}`
}

export function createOAuthBinding(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Bind the authorization to the browser that started it, the way the OIDC login
 * flow does. Returns false when the cookie config is unusable, so the caller can
 * refuse before allocating pending state.
 */
export function setOAuthTransactionCookie(
  c: Context<HonoEnv>,
  provider: string,
  state: string,
  binding: string,
): boolean {
  let secure: boolean
  try {
    secure = browserCookieSecure(c)
  } catch {
    return false
  }
  c.header('Cache-Control', 'no-store')
  setCookie(c, oauthTransactionCookieName(provider, state), binding, {
    httpOnly: true,
    secure,
    sameSite: 'Lax',
    path: callbackPath(provider),
    maxAge: PENDING_OAUTH_TTL_MS / 1000,
  })
  return true
}

export function readOAuthTransactionCookie(
  c: Context<HonoEnv>,
  provider: string,
  state: string,
): string | undefined {
  return getCookie(c, oauthTransactionCookieName(provider, state))
}

export function clearOAuthTransactionCookie(
  c: Context<HonoEnv>,
  provider: string,
  state: string,
): void {
  deleteCookie(c, oauthTransactionCookieName(provider, state), { path: callbackPath(provider) })
}
