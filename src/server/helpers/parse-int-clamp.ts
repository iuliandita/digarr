// Stand-in for the repeated `Math.max(min, Math.min(max, Number(...)))`
// idiom scattered across route files. Returns the default on missing input
// and throws a 400 HTTPException on non-integer / out-of-range values so
// callers never have to invent their own error copy.

import { HTTPException } from 'hono/http-exception'

type Options = {
  name: string
  min: number
  max: number
  default?: number
}

export function parseIntClamp(raw: string | undefined | null, opts: Options): number {
  if (raw == null || raw === '') {
    if (opts.default !== undefined) return opts.default
    throw new HTTPException(400, { message: `${opts.name} is required` })
  }
  const n = Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new HTTPException(400, { message: `${opts.name} must be an integer` })
  }
  if (n < opts.min || n > opts.max) {
    throw new HTTPException(400, {
      message: `${opts.name} out of range [${opts.min}, ${opts.max}]`,
    })
  }
  return n
}
