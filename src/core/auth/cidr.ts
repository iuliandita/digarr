function ipToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number.parseInt(octet, 10), 0) >>> 0
}

/** Check if an IPv4 address is within a CIDR range. IPv4 only - IPv6 CIDRs are not supported. */
export function isIpInCidr(ip: string, cidr: string): boolean {
  const [cidrIp, bitsStr] = cidr.split('/')
  if (!cidrIp) return false
  const bits = bitsStr ? Number.parseInt(bitsStr, 10) : 32
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
  return (ipToInt(ip) & mask) === (ipToInt(cidrIp) & mask)
}

export function isIpTrusted(ip: string, cidrs: string[]): boolean {
  let cleanIp = ip
  if (cleanIp.startsWith('::ffff:')) {
    cleanIp = cleanIp.slice(7)
  }
  return cidrs.some((cidr) => isIpInCidr(cleanIp, cidr))
}
