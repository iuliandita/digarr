// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { decodeCursor, encodeCursor } from '@/server/helpers/pagination-cursor'

describe('pagination cursor', () => {
  it('round-trips id + ts', () => {
    const out = encodeCursor({ id: 42, ts: '2026-04-19T00:00:00.000Z' })
    expect(decodeCursor(out)).toEqual({ id: 42, ts: '2026-04-19T00:00:00.000Z' })
  })

  it('returns null on malformed base64', () => {
    expect(decodeCursor('not-base64!!!')).toBeNull()
  })

  it('returns null on missing fields', () => {
    const bad = Buffer.from(JSON.stringify({ id: 1 })).toString('base64url')
    expect(decodeCursor(bad)).toBeNull()
  })

  it('returns null on wrong id type', () => {
    const bad = Buffer.from(JSON.stringify({ id: 'nope', ts: '2026-01-01' })).toString('base64url')
    expect(decodeCursor(bad)).toBeNull()
  })

  it('ignores extra fields on decode (forward-compat)', () => {
    const raw = Buffer.from(
      JSON.stringify({ id: 7, ts: '2026-01-01T00:00:00.000Z', extra: 'x' }),
    ).toString('base64url')
    expect(decodeCursor(raw)).toEqual({ id: 7, ts: '2026-01-01T00:00:00.000Z' })
  })
})
