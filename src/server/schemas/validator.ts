import { zValidator as zv } from '@hono/zod-validator'
import type * as z from 'zod'

// Consistent 400 response shape for every Zod-validated route. Clients key on
// `error` (stable machine code) and render per-field hints from `details`.
// Zod's English messages travel through unchanged; UI may translate by path+code.
type ValidationIssue = {
  path: (string | number)[]
  code: string
  message: string
}

// @hono/zod-validator Hook generic has a 6-arg signature that narrows
// ZodError<output<T>> per target. Using any on the error here keeps the hook
// reusable across targets without losing runtime behavior or output typing
// on the handler side (c.req.valid(...) stays inferred).
type AnyResult =
  | { success: true }
  // biome-ignore lint/suspicious/noExplicitAny: see comment above AnyResult
  | { success: false; error: any }

// biome-ignore lint/suspicious/noExplicitAny: hook may run against any target
const hook = (result: AnyResult, c: any) => {
  if (result.success) return
  const issues: ValidationIssue[] = (
    result.error?.issues ?? ([] as Array<{ path: unknown[]; code: string; message: string }>)
  ).map((i: { path: unknown[]; code: string; message: string }) => ({
    path: i.path.map((p) => (typeof p === 'symbol' ? p.toString() : (p as string | number))),
    code: i.code,
    message: i.message,
  }))
  // `error` is a human-readable summary so existing clients that read `data.error`
  // keep showing useful text. `code` is the stable machine identifier.
  // `details` carries the full structured issue list for form-level UIs.
  const first = issues[0]
  const summary = first
    ? first.path.length > 0
      ? `${first.path.join('.')}: ${first.message}`
      : first.message
    : 'Invalid request'
  return c.json({ error: summary, code: 'validation_failed' as const, details: issues }, 400)
}

export const zJson = <T extends z.ZodTypeAny>(schema: T) => zv('json', schema, hook)
export const zQuery = <T extends z.ZodTypeAny>(schema: T) => zv('query', schema, hook)
export const zParam = <T extends z.ZodTypeAny>(schema: T) => zv('param', schema, hook)
