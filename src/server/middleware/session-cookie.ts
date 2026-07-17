import type { Context } from 'hono'
import { envConfig } from '@/config/env'
import type { HonoEnv } from '@/server/types'

export const SESSION_COOKIE_NAME = 'digarr_session'

export type SessionCookieOptions = {
  httpOnly: true
  secure: boolean
  sameSite: 'Lax'
  path: '/'
  maxAge: number
}

/**
 * Decide whether browser cookies get the Secure attribute, from the public
 * origin protocol only (never X-Forwarded-Proto). Production defaults to Secure
 * even when the backend request arrives over HTTP (TLS-terminating proxy);
 * only an explicit DIGARR_ALLOW_INSECURE_COOKIES=true on an http: origin drops
 * it. Throws on an invalid or non-HTTP(S) public URL.
 */
export function browserCookieSecure(c: Context<HonoEnv>): boolean {
  const publicUrl = new URL(envConfig.allowedOrigin ?? c.req.url)
  if (!['http:', 'https:'].includes(publicUrl.protocol) || publicUrl.origin === 'null') {
    throw new TypeError('Browser cookie URL must use HTTP or HTTPS')
  }
  if (process.env.NODE_ENV === 'production') {
    return !(envConfig.allowInsecureCookies && publicUrl.protocol === 'http:')
  }
  return publicUrl.protocol === 'https:'
}

export function sessionCookieOptions(
  c: Context<HonoEnv>,
  maxAgeSeconds: number,
): SessionCookieOptions {
  return {
    httpOnly: true,
    secure: browserCookieSecure(c),
    sameSite: 'Lax',
    path: '/',
    maxAge: maxAgeSeconds,
  }
}
