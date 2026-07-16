import type { Context } from 'hono'
import { deleteCookie, setCookie } from 'hono/cookie'
import { generateSessionToken } from '@/core/auth'
import { createSession, deleteSession, replaceSession, resetUserSession } from '@/core/sessions'
import { SESSION_TTL_MS } from '@/db/queries/sessions'
import {
  SESSION_COOKIE_NAME,
  type SessionCookieOptions,
  sessionCookieOptions,
} from '@/server/middleware/session-cookie'
import type { HonoEnv } from '@/server/types'

type IssueOptions =
  | { kind: 'create'; cookie: false | PreparedSessionCookie; revokeTokens?: string[] }
  | {
      kind: 'rotate'
      cookie: false | PreparedSessionCookie
      requiredSourceToken: string
      revokeTokens?: string[]
    }

export type PreparedSessionCookie = {
  readonly options: SessionCookieOptions
}

export function cookieModeRequested(c: Context<HonoEnv>): boolean {
  return c.req.header('X-Digarr-Auth-Mode') === 'cookie'
}

export function clearSessionCookie(c: Context<HonoEnv>): void {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' })
}

function setSessionCookie(c: Context<HonoEnv>, token: string, options: SessionCookieOptions): void {
  setCookie(c, SESSION_COOKIE_NAME, token, options)
}

export function prepareSessionCookie(c: Context<HonoEnv>): PreparedSessionCookie {
  c.header('Cache-Control', 'no-store')
  return { options: sessionCookieOptions(c, SESSION_TTL_MS / 1000) }
}

export async function issueSession(
  c: Context<HonoEnv>,
  userId: number,
  options: IssueOptions,
): Promise<string> {
  c.header('Cache-Control', 'no-store')
  const cookieOptions = options.cookie ? options.cookie.options : undefined
  const token = generateSessionToken()
  if (options.kind === 'rotate') {
    await replaceSession(userId, token, options.requiredSourceToken, options.revokeTokens ?? [])
  } else {
    for (const revokedToken of new Set(options.revokeTokens ?? [])) {
      if (revokedToken !== token) await deleteSession(revokedToken)
    }
    await createSession(userId, token)
  }
  if (cookieOptions) setSessionCookie(c, token, cookieOptions)
  return token
}

export async function resetSession(
  c: Context<HonoEnv>,
  userId: number,
  cookie: boolean,
): Promise<string> {
  c.header('Cache-Control', 'no-store')
  const cookieOptions = cookie ? prepareSessionCookie(c).options : undefined
  const token = generateSessionToken()
  await resetUserSession(userId, token)
  if (cookieOptions) setSessionCookie(c, token, cookieOptions)
  return token
}
