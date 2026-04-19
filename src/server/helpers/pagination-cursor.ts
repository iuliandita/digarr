// Opaque cursor for keyset pagination. base64url-encoded JSON containing the
// (id, ts) of the last row in the previous page. Malformed cursors decode to
// null so the route treats them as a fresh request rather than erroring.

export type Cursor = { id: number; ts: string }

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url')
}

export function decodeCursor(raw: string): Cursor | null {
  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf8')
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
