// Opaque cursor for keyset pagination. The on-the-wire shape is
// `<base64url(JSON({id, ts}))>.<base64url(HMAC-SHA256)>`. The HMAC stops a
// client from synthesizing cursors and probing IDs they should not see;
// invalid signatures or malformed payloads decode to null so the route
// treats them as a fresh request rather than 4xx-ing.
//
// The signing key is derived from `DIGARR_ENCRYPTION_KEY` via HKDF when set,
// or a per-process random key when encryption is not configured. Either way
// cursors are stable within a process lifetime; pagination is short-lived
// enough that we accept invalidation across restarts.

import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'

export type Cursor = { id: number; ts: string }

let signingKey: Buffer | null = null

function getSigningKey(): Buffer {
  if (signingKey) return signingKey
  const seed = process.env.DIGARR_ENCRYPTION_KEY
  if (seed) {
    signingKey = Buffer.from(hkdfSync('sha256', seed, '', 'digarr-pagination-cursor', 32))
  } else {
    // Ephemeral per-process key. Cursors invalidate across restarts which is
    // acceptable for short-lived pagination state.
    signingKey = randomBytes(32)
  }
  return signingKey
}

/** Test-only: drop the cached signing key so the next call re-derives. */
export function __resetCursorKey(): void {
  signingKey = null
}

function sign(payload: string): string {
  return createHmac('sha256', getSigningKey()).update(payload).digest('base64url')
}

export function encodeCursor(cursor: Cursor): string {
  const payload = Buffer.from(JSON.stringify(cursor)).toString('base64url')
  return `${payload}.${sign(payload)}`
}

export function decodeCursor(raw: string): Cursor | null {
  try {
    const dot = raw.indexOf('.')
    if (dot <= 0 || dot === raw.length - 1) return null
    const payload = raw.slice(0, dot)
    const provided = Buffer.from(raw.slice(dot + 1), 'base64url')
    const expected = Buffer.from(sign(payload), 'base64url')
    if (provided.length !== expected.length) return null
    if (!timingSafeEqual(provided, expected)) return null

    const decoded = Buffer.from(payload, 'base64url').toString('utf8')
    const parsed = JSON.parse(decoded) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const p = parsed as Record<string, unknown>
    if (typeof p.id !== 'number' || Number.isNaN(p.id)) return null
    if (typeof p.ts !== 'string' || Number.isNaN(Date.parse(p.ts))) return null
    return { id: p.id, ts: p.ts }
  } catch {
    return null
  }
}
