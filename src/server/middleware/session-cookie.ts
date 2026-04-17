/**
 * Shared cookie name + options used by middleware that mints or reads session
 * cookies (proxy-auth, OIDC callback, cookie-based session resolution in the
 * auth guard).
 *
 * Cookies are httpOnly and SameSite=Lax so JS cannot read them and browsers
 * do not send them on cross-site top-level navigations.
 */

export const SESSION_COOKIE_NAME = 'digarr_session'

export type SessionCookieOptions = {
  httpOnly: true
  secure: boolean
  sameSite: 'Lax'
  path: '/'
  maxAge: number
}

export function sessionCookieOptions(maxAgeSeconds: number): SessionCookieOptions {
  return {
    httpOnly: true,
    // In tests (NODE_ENV=test) and local dev (http://localhost:*), `secure`
    // must be false or the browser will drop the cookie silently.
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    path: '/',
    maxAge: maxAgeSeconds,
  }
}
