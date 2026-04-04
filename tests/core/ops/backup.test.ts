// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('getKeyFingerprint', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns null when encryption is disabled', async () => {
    const { initEncryption, getKeyFingerprint } = await import('@/core/crypto')
    initEncryption(undefined)
    expect(getKeyFingerprint()).toBeNull()
  })

  it('returns a sha256: prefixed string when encryption is enabled', async () => {
    const { initEncryption, getKeyFingerprint } = await import('@/core/crypto')
    initEncryption('test-encryption-key-1234')
    const fp = getKeyFingerprint()
    expect(fp).not.toBeNull()
    expect(fp).toMatch(/^sha256:[a-f0-9]{64}$/)
  })

  it('returns same fingerprint for same key', async () => {
    const { initEncryption, getKeyFingerprint } = await import('@/core/crypto')
    initEncryption('test-key-abc')
    const fp1 = getKeyFingerprint()
    initEncryption('test-key-abc')
    const fp2 = getKeyFingerprint()
    expect(fp1).toBe(fp2)
  })

  it('returns different fingerprint for different key', async () => {
    const { initEncryption, getKeyFingerprint } = await import('@/core/crypto')
    initEncryption('key-alpha')
    const fp1 = getKeyFingerprint()
    initEncryption('key-beta')
    const fp2 = getKeyFingerprint()
    expect(fp1).not.toBe(fp2)
  })
})
