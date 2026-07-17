import { createHash } from 'node:crypto'
import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { PENDING_AUTH_TTL_MS } from '@/core/auth/oidc'
import { browserCookieSecure } from '@/server/middleware/session-cookie'
import type { HonoEnv } from '@/server/types'

const CALLBACK_PATH = '/api/v1/auth/oidc/callback'
const COOKIE_PREFIX = 'digarr_oidc_'

export type PreparedOidcTransactionCookie = {
  readonly secure: boolean
}

export function oidcTransactionCookieName(state: string): string {
  const suffix = createHash('sha256').update(state).digest('base64url').slice(0, 22)
  return `${COOKIE_PREFIX}${suffix}`
}

export function prepareOidcTransactionCookie(c: Context<HonoEnv>): PreparedOidcTransactionCookie {
  c.header('Cache-Control', 'no-store')
  return { secure: browserCookieSecure(c) }
}

export function setOidcTransactionCookie(
  c: Context<HonoEnv>,
  prepared: PreparedOidcTransactionCookie,
  state: string,
  binding: string,
): void {
  setCookie(c, oidcTransactionCookieName(state), binding, {
    httpOnly: true,
    secure: prepared.secure,
    sameSite: 'Lax',
    path: CALLBACK_PATH,
    maxAge: PENDING_AUTH_TTL_MS / 1000,
  })
}

export function readOidcTransactionCookie(c: Context<HonoEnv>, state: string): string | undefined {
  return getCookie(c, oidcTransactionCookieName(state))
}

export function clearOidcTransactionCookie(c: Context<HonoEnv>, state: string): void {
  deleteCookie(c, oidcTransactionCookieName(state), { path: CALLBACK_PATH })
}
