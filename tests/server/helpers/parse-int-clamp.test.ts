// @vitest-environment node

import { HTTPException } from 'hono/http-exception'
import { describe, expect, it } from 'vitest'
import {
  parseIntClamp,
  parseOptionalClampedInt,
  parsePositiveIntParam,
} from '@/server/helpers/parse-int-clamp'

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

describe('parsePositiveIntParam', () => {
  it('accepts positive decimal integer path params', () => {
    expect(parsePositiveIntParam('1')).toBe(1)
    expect(parsePositiveIntParam('42')).toBe(42)
  })

  it('rejects fractional, signed, zero, and unsafe path params', () => {
    expect(parsePositiveIntParam('1.5')).toBeNull()
    expect(parsePositiveIntParam('-1')).toBeNull()
    expect(parsePositiveIntParam('0')).toBeNull()
    expect(parsePositiveIntParam('9007199254740992')).toBeNull()
  })
})

describe('parseOptionalClampedInt', () => {
  it('uses the default for missing values and clamps numeric input', () => {
    expect(parseOptionalClampedInt(undefined, { min: 1, max: 20, default: 5 })).toBe(5)
    expect(parseOptionalClampedInt('0', { min: 1, max: 20, default: 5 })).toBe(1)
    expect(parseOptionalClampedInt('100', { min: 1, max: 20, default: 5 })).toBe(20)
  })

  it('rejects non-integer values', () => {
    expect(parseOptionalClampedInt('abc', { min: 1, max: 20, default: 5 })).toBeNull()
    expect(parseOptionalClampedInt('1.5', { min: 1, max: 20, default: 5 })).toBeNull()
  })
})
