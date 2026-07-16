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

export function sessionCookieOptions(
  c: Context<HonoEnv>,
  maxAgeSeconds: number,
): SessionCookieOptions {
  const publicUrl = new URL(envConfig.allowedOrigin ?? c.req.url)
  if (
    (publicUrl.protocol !== 'http:' && publicUrl.protocol !== 'https:') ||
    publicUrl.origin === 'null'
  ) {
    throw new TypeError('Session cookie URL must use HTTP or HTTPS')
  }
  return {
    httpOnly: true,
    secure: publicUrl.protocol === 'https:',
    sameSite: 'Lax',
    path: '/',
    maxAge: maxAgeSeconds,
  }
}
