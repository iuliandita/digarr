import { scryptSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { generateSessionToken, hashPassword, verifyPassword } from '@/core/auth'

describe('auth helpers', () => {
  // scrypt N=2^17 takes ~2-4s per hash - raise timeout for the full suite
  describe('hashPassword / verifyPassword', { timeout: 30_000 }, () => {
    it('verifies a correct password', async () => {
      const hash = await hashPassword('hunter2')
      expect(await verifyPassword('hunter2', hash)).toBe(true)
    })

    it('rejects a wrong password', async () => {
      const hash = await hashPassword('hunter2')
      expect(await verifyPassword('hunter3', hash)).toBe(false)
    })

    it('keeps timers responsive while verifying correct and incorrect passwords', async () => {
      const hash = await hashPassword('hunter2')
      for (const password of ['hunter2', 'wrong']) {
        const timer = new Promise<'timer'>((resolve) => setTimeout(() => resolve('timer'), 0))
        const verification = verifyPassword(password, hash)
        expect(await Promise.race([timer, verification])).toBe('timer')
        expect(await verification).toBe(password === 'hunter2')
      }
    })

    it('still verifies hashes made before the cost upgrade', async () => {
      const salt = '0123456789abcdef0123456789abcdef'
      const hash = `${salt}:${scryptSync('legacy-password', salt, 64).toString('hex')}`
      expect(await verifyPassword('legacy-password', hash)).toBe(true)
      expect(await verifyPassword('wrong', hash)).toBe(false)
    })

    it('produces different hashes for the same password (unique salts)', async () => {
      const h1 = await hashPassword('same-password')
      const h2 = await hashPassword('same-password')
      expect(h1).not.toBe(h2)
      // But both should verify
      expect(await verifyPassword('same-password', h1)).toBe(true)
      expect(await verifyPassword('same-password', h2)).toBe(true)
    })

    it('returns false for malformed stored hash', async () => {
      expect(await verifyPassword('test', 'not-a-valid-hash')).toBe(false)
      expect(await verifyPassword('test', '')).toBe(false)
      expect(await verifyPassword('test', ':')).toBe(false)
    })

    it('hash format is salt:hash', async () => {
      const hash = await hashPassword('test')
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
