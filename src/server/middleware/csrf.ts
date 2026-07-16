import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { envConfig } from '@/config/env'
import { problem } from '@/server/helpers/problem'
import type { HonoEnv } from '@/server/types'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const HEADER_AUTH = new Set(['session-bearer', 'legacy-bearer'])
const QUERY_AUTH = new Set(['session-query', 'legacy-query'])

function rejectRequest(c: Context<HonoEnv>) {
  return problem(c, 'csrf-validation-failed', 'Request rejected', 403)
}

function hasBrowserSignals(c: Context<HonoEnv>) {
  return (
    c.req.header('Origin') !== undefined ||
    c.req.header('Referer') !== undefined ||
    c.req.header('Sec-Fetch-Site') !== undefined
  )
}

function expectedOrigin(requestUrl: string): string | null {
  try {
    const url = new URL(envConfig.allowedOrigin ?? requestUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.origin === 'null' ? null : url.origin
  } catch {
    return null
  }
}

function hasSameOriginEvidence(c: Context<HonoEnv>): boolean {
  const expected = expectedOrigin(c.req.url)
  if (!expected) return false

  const origin = c.req.header('Origin')
  const fetchSite = c.req.header('Sec-Fetch-Site')

  if (fetchSite !== undefined) {
    if (fetchSite !== 'same-origin') return false
    return origin === undefined || origin === expected
  }

  if (origin !== undefined) return origin === expected

  const referer = c.req.header('Referer')
  if (referer === undefined) return false
  try {
    return new URL(referer).origin === expected
  } catch {
    return false
  }
}

export const csrfGuard = createMiddleware<HonoEnv>(async (c, next) => {
  if (!c.req.path.startsWith('/api/v1/') || SAFE_METHODS.has(c.req.method)) return next()

  const authMethod = c.get('authMethod')
  if (authMethod && HEADER_AUTH.has(authMethod)) return next()
  if (authMethod && QUERY_AUTH.has(authMethod)) return rejectRequest(c)

  const browserSignals = hasBrowserSignals(c)
  if (!authMethod && !browserSignals) return next()

  if (c.req.header('X-Digarr-CSRF') !== '1' || !hasSameOriginEvidence(c)) {
    return rejectRequest(c)
  }

  return next()
})
