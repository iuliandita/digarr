import { describe, expect, it } from 'vitest'
import { assertCidr, ipInCidr, ipv4InCidr, ipv6InCidr, isIpTrusted } from '@/core/auth/cidr'

describe('ipv4InCidr', () => {
  it('matches within range', () => {
    expect(ipv4InCidr('10.0.0.1', '10.0.0.0/8')).toBe(true)
    expect(ipv4InCidr('192.168.1.5', '192.168.0.0/16')).toBe(true)
  })

  it('rejects out-of-range', () => {
    expect(ipv4InCidr('11.0.0.1', '10.0.0.0/8')).toBe(false)
  })

  it('rejects malformed ip', () => {
    expect(ipv4InCidr('999.0.0.1', '10.0.0.0/8')).toBe(false)
    expect(ipv4InCidr('10.0.0', '10.0.0.0/8')).toBe(false)
    expect(ipv4InCidr('10.0.0.0.1', '10.0.0.0/8')).toBe(false)
  })

  it('rejects malformed cidr bits', () => {
    expect(() => ipv4InCidr('10.0.0.1', '10.0.0.0/33')).toThrow()
    expect(() => ipv4InCidr('10.0.0.1', '10.0.0.0/-1')).toThrow()
  })

  it('rejects leading-zero octets', () => {
    expect(ipv4InCidr('010.0.0.1', '10.0.0.0/8')).toBe(false)
    expect(ipv4InCidr('10.0.0.1', '010.0.0.0/8')).toBe(false)
  })

  it('rejects leading-zero cidr bits', () => {
    expect(() => ipv4InCidr('10.0.0.1', '10.0.0.0/08')).toThrow(/invalid cidr bits/i)
  })
})

describe('ipv6InCidr', () => {
  it('matches within range', () => {
    expect(ipv6InCidr('fd00::1', 'fd00::/8')).toBe(true)
    expect(ipv6InCidr('2001:db8::1', '2001:db8::/32')).toBe(true)
  })

  it('rejects the Cloudflare/Beef trap from the audit', () => {
    expect(ipv6InCidr('2400:beef::1', '2400:cb00::/32')).toBe(false)
  })

  it('rejects documentation range from private range', () => {
    expect(ipv6InCidr('2001:db8::1', 'fd00::/8')).toBe(false)
  })

  it('rejects malformed /bits', () => {
    expect(() => ipv6InCidr('fd00::1', 'fd00::/129')).toThrow()
  })
})

describe('ipv6InCidr zone IDs', () => {
  it('strips zone id before matching', () => {
    expect(ipv6InCidr('fe80::1%eth0', 'fe80::/10')).toBe(true)
  })
})

describe('ipInCidr dispatch', () => {
  it('detects family by colon presence', () => {
    expect(ipInCidr('10.0.0.1', '10.0.0.0/8')).toBe(true)
    expect(ipInCidr('fd00::1', 'fd00::/8')).toBe(true)
  })

  it('returns false for mixed-family pairs', () => {
    expect(ipInCidr('::1', '10.0.0.0/8')).toBe(false)
    expect(ipInCidr('10.0.0.1', 'fd00::/8')).toBe(false)
  })
})

describe('assertCidr', () => {
  it('rejects 0.0.0.0/0', () => {
    expect(() => assertCidr('0.0.0.0/0')).toThrow(/refuses unbounded CIDR/i)
  })

  it('rejects ::/0', () => {
    expect(() => assertCidr('::/0')).toThrow(/refuses unbounded CIDR/i)
  })

  it('accepts tight ranges', () => {
    expect(() => assertCidr('10.0.0.0/8')).not.toThrow()
    expect(() => assertCidr('fd00::/8')).not.toThrow()
  })

  it('rejects unbounded CIDR in alternate textual forms', () => {
    // /00 is caught by the stricter bits-syntax guard before the semantic check runs;
    // either rejection path is acceptable -- the point is that it is refused.
    expect(() => assertCidr('0.0.0.0/00')).toThrow(/invalid cidr bits|refuses unbounded CIDR/i)
    expect(() => assertCidr('0000::/0')).toThrow(/refuses unbounded CIDR/i)
    expect(() => assertCidr('::0/0')).toThrow(/refuses unbounded CIDR/i)
    expect(() => assertCidr('0:0:0:0:0:0:0:0/0')).toThrow(/refuses unbounded CIDR/i)
  })
})

describe('isIpTrusted', () => {
  it('returns true when ip is within one of the cidrs', () => {
    expect(isIpTrusted('192.168.1.5', ['10.0.0.0/8', '192.168.0.0/16'])).toBe(true)
  })
  it('returns false when ip matches none', () => {
    expect(isIpTrusted('8.8.8.8', ['10.0.0.0/8', '192.168.0.0/16'])).toBe(false)
  })
  it('returns false for empty cidr list', () => {
    expect(isIpTrusted('10.0.0.1', [])).toBe(false)
  })
  it('strips IPv4-mapped IPv6 prefix before matching', () => {
    expect(isIpTrusted('::ffff:192.168.1.5', ['192.168.0.0/16'])).toBe(true)
  })
})
