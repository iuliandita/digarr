import { createHash } from 'node:crypto'
import { createMiddleware } from 'hono/factory'
import { problem } from '@/server/helpers/problem'
import type { HonoEnv } from '@/server/types'

type Entry = {
  bodyHash: string
  expiresAt: number
  stored?: { status: number; contentType: string | null; body: string }
}

const KEY_PATTERN = /^[\x21-\x7e]{1,255}$/

/**
 * Opt-in `Idempotency-Key` support, scoped per user. In-memory and per process,
 * like the rate limiters: Digarr runs as a single process, so no shared store.
 * A restart forgets keys; 5xx responses are never stored so those stay retryable.
 */
export function idempotency(opts: { ttlMs?: number; maxEntries?: number } = {}) {
  const ttlMs = opts.ttlMs ?? 24 * 60 * 60 * 1000
  const maxEntries = opts.maxEntries ?? 5000
  const entries = new Map<string, Entry>()

  const prune = () => {
    const now = Date.now()
    for (const [k, e] of entries) if (e.expiresAt <= now) entries.delete(k)
    if (entries.size < maxEntries) return
    for (const [k, e] of entries) {
      if (e.stored) entries.delete(k)
      if (entries.size < maxEntries) return
    }
  }

  return createMiddleware<HonoEnv>(async (c, next) => {
    const key = c.req.header('Idempotency-Key')
    if (key === undefined) return next()
    if (!KEY_PATTERN.test(key)) {
      return problem(
        c,
        'invalid-idempotency-key',
        'Invalid Idempotency-Key',
        400,
        'Idempotency-Key must be 1-255 printable ASCII characters without spaces',
      )
    }

    const bodyHash = createHash('sha256')
      .update(await c.req.text())
      .digest('hex')
    const scoped = `${c.get('userId') ?? 0}:${key}`
    const existing = entries.get(scoped)
    if (existing && existing.expiresAt > Date.now()) {
      if (existing.bodyHash !== bodyHash) {
        return problem(
          c,
          'idempotency-key-reuse',
          'Idempotency-Key reused with a different request body',
          422,
        )
      }
      if (!existing.stored) {
        return problem(
          c,
          'idempotency-request-in-flight',
          'A request with this Idempotency-Key is still in progress',
          409,
        )
      }
      const { status, contentType, body } = existing.stored
      return new Response(body, {
        status,
        headers: {
          ...(contentType ? { 'content-type': contentType } : {}),
          'Idempotent-Replayed': 'true',
        },
      })
    }

    prune()
    const entry: Entry = { bodyHash, expiresAt: Date.now() + ttlMs }
    entries.set(scoped, entry)
    let keep = false
    try {
      await next()
      const res = c.res
      if (res.status < 500) {
        entry.stored = {
          status: res.status,
          contentType: res.headers.get('content-type'),
          body: await res.clone().text(),
        }
        keep = true
      }
    } finally {
      if (!keep && entries.get(scoped) === entry) entries.delete(scoped)
    }
  })
}
