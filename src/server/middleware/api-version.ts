import type { MiddlewareHandler } from 'hono'

// Redirects legacy /api/* URLs to their /api/v1/* equivalent. 308 (not 307)
// because the move is permanent - /api/* will be removed in a future major
// release. 308 preserves method + body across HTTP/1.1 clients that post-date
// RFC 7538 (2015+). Deprecation / Sunset headers signal the planned removal
// (RFC 9745 + RFC 8594).
const SUNSET = 'Sat, 19 Jul 2026 00:00:00 GMT'

export const apiVersionRedirect: MiddlewareHandler = async (c, next) => {
  const path = c.req.path
  if (!path.startsWith('/api/')) return next()
  if (path.startsWith('/api/v1/') || path === '/api/v1') return next()

  const rest = path.slice('/api/'.length)
  const url = new URL(c.req.url)
  const target = `/api/v1/${rest}${url.search}`

  return c.body(null, 308, {
    location: target,
    deprecation: 'true',
    sunset: SUNSET,
  })
}
