import type { Context } from 'hono'

// RFC 9457 "Problem Details for HTTP APIs" envelope. Used by the top-level
// onError handler and any route that returns a structured error. Keeping
// `type` as a relative slug keeps the response payload small and avoids
// baking in the public domain — clients treat it as an opaque token.
//
// `code` is a stable i18n key (e.g. `errors.target.notFound`). The server
// stays locale-agnostic; the client resolves the key against the active
// locale and falls back to `title` when the key is unknown.

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
