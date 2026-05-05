// @vitest-environment node
import { createHmac, hkdfSync } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __resetCursorKey, decodeCursor, encodeCursor } from '@/server/helpers/pagination-cursor'

const ENC_KEY = 'test-encryption-key-for-cursor-signing'

beforeEach(() => {
  process.env.DIGARR_ENCRYPTION_KEY = ENC_KEY
  __resetCursorKey()
})

afterEach(() => {
  delete process.env.DIGARR_ENCRYPTION_KEY
  __resetCursorKey()
})

describe('pagination cursor', () => {
  it('round-trips id + ts', () => {
    const out = encodeCursor({ id: 42, ts: '2026-04-19T00:00:00.000Z' })
    expect(decodeCursor(out)).toEqual({ id: 42, ts: '2026-04-19T00:00:00.000Z' })
  })

  it('returns null on malformed base64', () => {
    expect(decodeCursor('not-base64!!!')).toBeNull()
  })

  it('returns null when the signature is missing entirely', () => {
    const payloadOnly = Buffer.from(
      JSON.stringify({ id: 7, ts: '2026-01-01T00:00:00.000Z' }),
    ).toString('base64url')
    // No `.<signature>` suffix - rejected by the decoder before any JSON parse.
    expect(decodeCursor(payloadOnly)).toBeNull()
  })

  it('returns null when the signature is forged with the wrong secret', () => {
    const payload = Buffer.from(
      JSON.stringify({ id: 99, ts: '2026-01-01T00:00:00.000Z' }),
    ).toString('base64url')
    const wrongKey = Buffer.from(
      hkdfSync('sha256', 'attacker-secret', '', 'digarr-pagination-cursor', 32),
    )
    const forgedSig = createHmac('sha256', wrongKey).update(payload).digest('base64url')
    expect(decodeCursor(`${payload}.${forgedSig}`)).toBeNull()
  })

  it('returns null when the payload is tampered after signing', () => {
    const original = encodeCursor({ id: 1, ts: '2026-01-01T00:00:00.000Z' })
    // Replace the signed payload with a different one but keep the original signature.
    const tamperedPayload = Buffer.from(
      JSON.stringify({ id: 999, ts: '2026-01-01T00:00:00.000Z' }),
    ).toString('base64url')
    const sig = original.slice(original.indexOf('.') + 1)
    expect(decodeCursor(`${tamperedPayload}.${sig}`)).toBeNull()
  })

  it('returns null on missing fields even with a valid signature', () => {
    // A correctly-signed but structurally-incomplete payload: forged via the
    // production code path (encodeCursor over a non-Cursor object would not
    // type-check, so we sign manually with the same key derivation).
    const payload = Buffer.from(JSON.stringify({ id: 1 })).toString('base64url')
    const key = Buffer.from(hkdfSync('sha256', ENC_KEY, '', 'digarr-pagination-cursor', 32))
    const sig = createHmac('sha256', key).update(payload).digest('base64url')
    expect(decodeCursor(`${payload}.${sig}`)).toBeNull()
  })

  it('returns null on wrong id type even with a valid signature', () => {
    const payload = Buffer.from(JSON.stringify({ id: 'nope', ts: '2026-01-01' })).toString(
      'base64url',
    )
    const key = Buffer.from(hkdfSync('sha256', ENC_KEY, '', 'digarr-pagination-cursor', 32))
    const sig = createHmac('sha256', key).update(payload).digest('base64url')
    expect(decodeCursor(`${payload}.${sig}`)).toBeNull()
  })

  it('ignores extra fields on decode (forward-compat) when signature is valid', () => {
    const payload = Buffer.from(
      JSON.stringify({ id: 7, ts: '2026-01-01T00:00:00.000Z', extra: 'x' }),
    ).toString('base64url')
    const key = Buffer.from(hkdfSync('sha256', ENC_KEY, '', 'digarr-pagination-cursor', 32))
    const sig = createHmac('sha256', key).update(payload).digest('base64url')
    expect(decodeCursor(`${payload}.${sig}`)).toEqual({
      id: 7,
      ts: '2026-01-01T00:00:00.000Z',
    })
  })

  it('falls back to a per-process key when DIGARR_ENCRYPTION_KEY is unset', () => {
    delete process.env.DIGARR_ENCRYPTION_KEY
    __resetCursorKey()
    // Without a configured secret, encodeCursor still produces a signed cursor
    // and decodeCursor still verifies it, but the signing key is ephemeral
    // (regenerated on next __resetCursorKey()).
    const out = encodeCursor({ id: 5, ts: '2026-01-01T00:00:00.000Z' })
    expect(decodeCursor(out)).toEqual({ id: 5, ts: '2026-01-01T00:00:00.000Z' })
    __resetCursorKey()
    // After resetting, the previously-issued cursor no longer verifies.
    expect(decodeCursor(out)).toBeNull()
  })
})
