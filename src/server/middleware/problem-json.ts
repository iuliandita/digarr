import type { MiddlewareHandler } from 'hono'
import { legacyErrorToProblem } from '@/server/helpers/problem'

// Converts any remaining `{error, ...}` JSON error body into problem+json, so
// routes and middleware that still build the legacy shape cannot leak it.
export function problemJsonErrors(): MiddlewareHandler {
  return async (c, next) => {
    await next()
    const res = c.res
    if (res.status < 400) return
    if (!res.headers.get('content-type')?.startsWith('application/json')) return
    let body: unknown
    try {
      body = await res.clone().json()
    } catch {
      return
    }
    if (!body || typeof body !== 'object' || Array.isArray(body) || !('error' in body)) return
    const headers = new Headers(res.headers)
    headers.set('content-type', 'application/problem+json')
    headers.delete('content-length')
    // Clearing first stops Hono from merging the old response's headers back in.
    c.res = undefined
    c.res = new Response(
      JSON.stringify(legacyErrorToProblem(res.status, body as Record<string, unknown>)),
      { status: res.status, headers },
    )
  }
}
