import { STATUS_CODES } from 'node:http'
import type { Context } from 'hono'

// RFC 9457 "Problem Details for HTTP APIs" envelope. Used by the top-level
// onError handler and any route that returns a structured error. Keeping
// `type` as a relative slug keeps the response payload small and avoids
// baking in the public domain — clients treat it as an opaque token.
//
// `code` is a stable i18n key (e.g. `errors.target.notFound`). The server
// stays locale-agnostic; the client resolves the key against the active
// locale and falls back to `title` (or `error`, when present) for unknown keys.
// Routes that predate problem+json may also put a stable machine code there.
//
// `error` is a deprecated extension carrying the same text as `detail`, kept so
// clients written against the old `{error}` bodies keep working.

export type ProblemBody = {
  type: string
  title: string
  status: number
  code?: string
  detail?: string
  [extension: string]: unknown
}

export function problem(
  c: Context,
  type: string,
  title: string,
  status: number,
  detail?: string,
  extensions?: Record<string, unknown>,
  code?: string,
) {
  const body: ProblemBody = {
    type: `/problems/${type}`,
    title,
    status,
    ...(code !== undefined ? { code } : {}),
    ...(detail !== undefined ? { detail } : {}),
    ...(extensions ?? {}),
  }
  return c.json(body, status as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503, {
    'content-type': 'application/problem+json',
  })
}

export function notFoundProblem(c: Context, type: string, title: string, code: string) {
  return problem(c, type, title, 404, undefined, undefined, code)
}

export function statusTitle(status: number): string {
  return STATUS_CODES[status] ?? 'Error'
}

// Wraps a legacy `{error, ...}` body. Problem members win over colliding legacy
// keys so the envelope stays RFC 9457 compliant.
export function legacyErrorToProblem(status: number, body: Record<string, unknown>): ProblemBody {
  const message =
    typeof body.error === 'string'
      ? body.error
      : typeof body.message === 'string'
        ? body.message
        : undefined
  return {
    ...body,
    type: `/problems/http-${status}`,
    title: statusTitle(status),
    status,
    ...(message !== undefined ? { detail: message } : {}),
  }
}
