// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { conciseErrMsg, getLookupHostname, isPrivateIp, isRfc1918 } from '@/core/validation'

describe('conciseErrMsg', () => {
  it('redacts credentials from nested source error messages', () => {
    const error = new Error(
      'request failed https://media.invalid/rest?t=tok_1234567890&s=salt_123456&token=session123456 api_key=provider123456 Bearer eyJhbGciOiJIUzI1NiJ9.payload sk-proj-abc123def456',
    )

    const message = conciseErrMsg(error)

    expect(message).toContain('t=[redacted]')
    expect(message).toContain('s=[redacted]')
    expect(message).toContain('token=[redacted]')
    expect(message).toContain('api_key=[redacted]')
    expect(message).toContain('Bearer [redacted]')
    expect(message).not.toContain('tok_1234567890')
    expect(message).not.toContain('salt_123456')
    expect(message).not.toContain('session123456')
    expect(message).not.toContain('provider123456')
    expect(message).not.toContain('eyJhbGciOiJIUzI1NiJ9')
    expect(message).not.toContain('sk-proj-abc123def456')
  })

  it('bounds arbitrary error codes without exposing credentials', () => {
    for (const code of [
      `postgres://user:s3cret@db/library-${'x'.repeat(400)}`,
      'sk-abcdefghijklmno',
    ]) {
      const message = conciseErrMsg(Object.assign(new Error('database write failed'), { code }))

      expect(message).toBe('database write failed')
      expect(message).not.toContain('s3cret')
      expect(message).not.toContain('sk-')
      expect(message.length).toBeLessThanOrEqual(300)
    }
  })
})

describe('isPrivateIp', () => {
  it('rejects IPv4 reserved and documentation ranges', () => {
    expect(isPrivateIp('0.0.0.0')).toBe(true)
    expect(isPrivateIp('0.12.34.56')).toBe(true)
    expect(isPrivateIp('198.18.0.1')).toBe(true)
    expect(isPrivateIp('198.19.255.255')).toBe(true)
    expect(isPrivateIp('192.0.2.1')).toBe(true)
    expect(isPrivateIp('198.51.100.1')).toBe(true)
    expect(isPrivateIp('203.0.113.1')).toBe(true)
    expect(isPrivateIp('224.0.0.1')).toBe(true)
    expect(isPrivateIp('240.0.0.1')).toBe(true)
    expect(isPrivateIp('255.255.255.255')).toBe(true)
  })

  it('rejects IPv6 reserved and documentation ranges', () => {
    expect(isPrivateIp('::')).toBe(true)
    expect(isPrivateIp('::1')).toBe(true)
    expect(isPrivateIp('fc00::1')).toBe(true)
    expect(isPrivateIp('fd12:3456:789a::1')).toBe(true)
    expect(isPrivateIp('fe80::1')).toBe(true)
    expect(isPrivateIp('ff02::1')).toBe(true)
    expect(isPrivateIp('64:ff9b::1')).toBe(true)
    expect(isPrivateIp('64:ff9b::192.0.2.33')).toBe(true)
    expect(isPrivateIp('2001::1')).toBe(true)
    expect(isPrivateIp('2001::192.0.2.33')).toBe(true)
    expect(isPrivateIp('2001:db8::1')).toBe(true)
    expect(isPrivateIp('2001:db8::192.0.2.33')).toBe(true)
  })

  it('allows public addresses', () => {
    expect(isPrivateIp('8.8.8.8')).toBe(false)
    expect(isPrivateIp('1.1.1.1')).toBe(false)
    expect(isPrivateIp('93.184.216.34')).toBe(false)
    expect(isPrivateIp('2001:4860:4860::8888')).toBe(false)
  })
})

describe('getLookupHostname', () => {
  it('strips IPv6 brackets before DNS lookup', () => {
    expect(getLookupHostname('https://[2001:4860:4860::8888]:32400/library')).toBe(
      '2001:4860:4860::8888',
    )
  })

  it('preserves regular hostnames for DNS lookup', () => {
    expect(getLookupHostname('https://hooks.example.com/webhook')).toBe('hooks.example.com')
  })
})

describe('isRfc1918', () => {
  it('classifies RFC1918 ranges as waivable', () => {
    expect(isRfc1918('10.0.0.5')).toBe(true)
    expect(isRfc1918('172.16.3.4')).toBe(true)
    expect(isRfc1918('172.31.255.255')).toBe(true)
    expect(isRfc1918('192.168.1.10')).toBe(true)
  })
  it('does NOT classify metadata, link-local, loopback, ULA, CGNAT as waivable', () => {
    expect(isRfc1918('169.254.169.254')).toBe(false)
    expect(isRfc1918('169.254.1.1')).toBe(false)
    expect(isRfc1918('127.0.0.1')).toBe(false)
    expect(isRfc1918('100.64.0.1')).toBe(false)
    expect(isRfc1918('fd00::1')).toBe(false)
    expect(isRfc1918('8.8.8.8')).toBe(false)
    expect(isRfc1918('172.15.0.1')).toBe(false)
    expect(isRfc1918('172.32.0.1')).toBe(false)
  })
})
