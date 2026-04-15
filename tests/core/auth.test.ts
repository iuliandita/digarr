import { describe, expect, it } from 'vitest'
import { generateSessionToken, hashPassword, verifyPassword } from '@/core/auth'

describe('auth helpers', () => {
  // scrypt N=2^17 takes ~2-4s per hash - raise timeout for the full suite
  describe('hashPassword / verifyPassword', { timeout: 30_000 }, () => {
    it('verifies a correct password', () => {
      const hash = hashPassword('hunter2')
      expect(verifyPassword('hunter2', hash)).toBe(true)
    })

    it('rejects a wrong password', () => {
      const hash = hashPassword('hunter2')
      expect(verifyPassword('hunter3', hash)).toBe(false)
    })

    it('produces different hashes for the same password (unique salts)', () => {
      const h1 = hashPassword('same-password')
      const h2 = hashPassword('same-password')
      expect(h1).not.toBe(h2)
      // But both should verify
      expect(verifyPassword('same-password', h1)).toBe(true)
      expect(verifyPassword('same-password', h2)).toBe(true)
    })

    it('returns false for malformed stored hash', () => {
      expect(verifyPassword('test', 'not-a-valid-hash')).toBe(false)
      expect(verifyPassword('test', '')).toBe(false)
      expect(verifyPassword('test', ':')).toBe(false)
    })

    it('hash format is salt:hash', () => {
      const hash = hashPassword('test')
      const parts = hash.split(':')
      expect(parts).toHaveLength(2)
      // Salt is 16 bytes = 32 hex chars
      expect(parts[0]).toHaveLength(32)
      // Hash is 64 bytes = 128 hex chars
      expect(parts[1]).toHaveLength(128)
    })
  })

  describe('generateSessionToken', () => {
    it('returns a 64-char hex string', () => {
      const token = generateSessionToken()
      expect(token).toHaveLength(64)
      expect(token).toMatch(/^[0-9a-f]+$/)
    })

    it('generates unique tokens', () => {
      const tokens = new Set(Array.from({ length: 10 }, () => generateSessionToken()))
      expect(tokens.size).toBe(10)
    })
  })
})
