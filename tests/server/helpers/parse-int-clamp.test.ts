// @vitest-environment node

import { HTTPException } from 'hono/http-exception'
import { describe, expect, it } from 'vitest'
import { parseIntClamp } from '@/server/helpers/parse-int-clamp'

describe('parseIntClamp', () => {
  it('returns parsed int within range', () => {
    expect(parseIntClamp('10', { name: 'x', min: 1, max: 100 })).toBe(10)
  })

  it('returns default when value missing', () => {
    expect(parseIntClamp(undefined, { name: 'x', min: 1, max: 100, default: 20 })).toBe(20)
    expect(parseIntClamp(null, { name: 'x', min: 1, max: 100, default: 20 })).toBe(20)
    expect(parseIntClamp('', { name: 'x', min: 1, max: 100, default: 20 })).toBe(20)
  })

  it('throws 400 when missing and no default', () => {
    expect(() => parseIntClamp(undefined, { name: 'x', min: 1, max: 100 })).toThrow(HTTPException)
  })

  it('throws 400 on non-integer', () => {
    expect(() => parseIntClamp('abc', { name: 'x', min: 1, max: 100 })).toThrow(HTTPException)
    expect(() => parseIntClamp('1.5', { name: 'x', min: 1, max: 100 })).toThrow(HTTPException)
    expect(() => parseIntClamp('Infinity', { name: 'x', min: 1, max: 100 })).toThrow(HTTPException)
  })

  it('throws 400 on out-of-range', () => {
    expect(() => parseIntClamp('0', { name: 'x', min: 1, max: 100 })).toThrow(HTTPException)
    expect(() => parseIntClamp('101', { name: 'x', min: 1, max: 100 })).toThrow(HTTPException)
  })

  it('accepts boundary values', () => {
    expect(parseIntClamp('1', { name: 'x', min: 1, max: 100 })).toBe(1)
    expect(parseIntClamp('100', { name: 'x', min: 1, max: 100 })).toBe(100)
  })
})
