import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  decryptField,
  encryptField,
  encryptFields,
  getKeyFingerprint,
  initEncryption,
  isEncryptionEnabled,
} from '@/core/crypto'

function encryptWithLegacyKey(value: string, keyInput: string): string {
  const key = createHash('sha256').update(keyInput).digest()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `enc:v1:${iv.toString('base64')}.${encrypted.toString('base64')}.${tag.toString('base64')}`
}

describe('crypto', () => {
  beforeEach(() => {
    initEncryption('test-key-please-do-not-use-in-prod')
  })

  afterEach(() => {
    initEncryption(undefined)
  })

  describe('encryptField / decryptField', () => {
    it('round-trips simple strings', () => {
      const plain = 'hello world'
      const enc = encryptField(plain)
      expect(enc).not.toBe(plain)
      expect(enc?.startsWith('enc:v1:')).toBe(true)
      expect(decryptField(enc)).toBe(plain)
    })

    it('round-trips unicode and multi-byte strings', () => {
      const plain = 'ünîcødé-πŘ-🔑-中文'
      const enc = encryptField(plain)
      expect(decryptField(enc)).toBe(plain)
    })

    it('round-trips long strings', () => {
      const plain = 'x'.repeat(10_000)
      const enc = encryptField(plain)
      expect(decryptField(enc)).toBe(plain)
    })

    it('produces a fresh IV per call (same plaintext yields different ciphertext)', () => {
      const a = encryptField('same-secret')
      const b = encryptField('same-secret')
      expect(a).not.toBe(b)
      expect(decryptField(a)).toBe('same-secret')
      expect(decryptField(b)).toBe('same-secret')
    })

    it('is idempotent: already-encrypted values pass through unchanged', () => {
      const enc = encryptField('secret')
      expect(encryptField(enc)).toBe(enc)
    })

    it('passes plaintext through decryptField (pre-migration values)', () => {
      expect(decryptField('legacy-plaintext-token')).toBe('legacy-plaintext-token')
    })

    it('preserves null and undefined values', () => {
      expect(encryptField(null)).toBe(null)
      expect(encryptField(undefined)).toBe(undefined)
      expect(decryptField(null)).toBe(null)
      expect(decryptField(undefined)).toBe(undefined)
    })

    it('returns value unchanged when encryption is disabled', () => {
      initEncryption(undefined)
      expect(isEncryptionEnabled()).toBe(false)
      expect(encryptField('plain')).toBe('plain')
    })

    it('throws on wrong key', () => {
      const enc = encryptField('secret')
      initEncryption('a-completely-different-key')
      expect(() => decryptField(enc)).toThrow(/Decryption failed/)
    })

    it('returns malformed prefix values as-is (no throw)', () => {
      expect(decryptField('enc:v1:')).toBe('enc:v1:')
      expect(decryptField('enc:v1:missingparts')).toBe('enc:v1:missingparts')
    })
  })

  describe('legacy SHA-256 key fallback', () => {
    it('decrypts values encrypted under the legacy SHA-256 key', () => {
      const enc = encryptWithLegacyKey('value', 'shared-secret-v1')
      initEncryption('shared-secret-v1')
      expect(decryptField(enc)).toBe('value')
    })

    it('decrypts legacy ciphertext through NEXT after the rotation key swap', () => {
      const enc = encryptWithLegacyKey('value', 'old-key')

      initEncryption('new-key', 'old-key')

      expect(decryptField(enc)).toBe('value')
    })
  })

  describe('dual-key rotation mode', () => {
    it('decryptField falls back to NEXT key when primary cannot decrypt', () => {
      initEncryption('old-key')
      const enc = encryptField('rotated-value')

      // Simulate the post-swap state: new key is primary, old key is NEXT.
      initEncryption('new-key', 'old-key')
      expect(decryptField(enc)).toBe('rotated-value')
    })

    it('encryptField always uses the primary key even in dual-key mode', () => {
      initEncryption('primary-key', 'fallback-key')
      const enc = encryptField('value') as string

      // Dropping NEXT, primary alone must still decrypt what we just wrote.
      initEncryption('primary-key')
      expect(decryptField(enc)).toBe('value')
    })

    it('throws when neither key can decrypt', () => {
      initEncryption('old-key')
      const enc = encryptField('value')

      initEncryption('wrong-primary', 'wrong-next')
      expect(() => decryptField(enc)).toThrow(/Decryption failed/)
    })
  })

  describe('encryptFields / decryptFields', () => {
    it('is idempotent on already-encrypted rows', () => {
      const row = { accessToken: 'secret' }
      const once = encryptFields(row, ['accessToken'])
      const twice = encryptFields(once, ['accessToken'])
      expect(twice.accessToken).toBe(once.accessToken)
    })
  })

  describe('getKeyFingerprint', () => {
    it('returns a stable hash for the same key input', () => {
      const a = getKeyFingerprint()
      initEncryption('test-key-please-do-not-use-in-prod')
      const b = getKeyFingerprint()
      expect(a).toBe(b)
      expect(a).toMatch(/^sha256:[0-9a-f]{64}$/)
    })

    it('differs between distinct keys', () => {
      const a = getKeyFingerprint()
      initEncryption('different-key')
      const b = getKeyFingerprint()
      expect(a).not.toBe(b)
    })

    it('returns null when encryption is disabled', () => {
      initEncryption(undefined)
      expect(getKeyFingerprint()).toBe(null)
    })
  })
})
