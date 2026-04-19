// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { getLookupHostname, isPrivateIp } from '@/core/validation'

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
