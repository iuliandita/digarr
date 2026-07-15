const IPV4_OCTET = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/

function parseIpv4(ip: string): bigint | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let acc = 0n
  for (const p of parts) {
    if (!IPV4_OCTET.test(p)) return null
    acc = (acc << 8n) | BigInt(Number(p))
  }
  return acc
}

// RFC 4291 section 2.2 form 3: expand a trailing dotted quad (e.g. ::ffff:10.0.0.1)
// into two 16-bit hex groups so the main group loop can stay hex-only.
function expandDottedQuad(groups: string[]): string[] | null {
  const last = groups[groups.length - 1] ?? ''
  if (!last.includes('.')) return groups
  const v4 = parseIpv4(last)
  if (v4 === null) return null
  return [...groups.slice(0, -1), ((v4 >> 16n) & 0xffffn).toString(16), (v4 & 0xffffn).toString(16)]
}

function parseIpv6(ip: string): bigint | null {
  if (!ip.includes(':')) return null
  const zoneStripped = ip.split('%')[0] as string
  const parts = zoneStripped.split('::')
  if (parts.length > 2) return null

  const headRaw = parts[0] ?? ''
  const tailRaw = parts.length === 2 ? (parts[1] ?? '') : ''
  let head = headRaw === '' ? [] : headRaw.split(':')
  let tail = parts.length === 2 ? (tailRaw === '' ? [] : tailRaw.split(':')) : []

  if (parts.length === 2 && tail.length > 0) {
    const expanded = expandDottedQuad(tail)
    if (expanded === null) return null
    tail = expanded
  } else if (parts.length === 1) {
    const expanded = expandDottedQuad(head)
    if (expanded === null) return null
    head = expanded
  }

  if (parts.length === 1 && head.length !== 8) return null

  const missing = 8 - head.length - tail.length
  if (parts.length === 2 && missing < 0) return null

  const groups = [...head, ...Array<string>(missing).fill('0'), ...tail]
  if (groups.length !== 8) return null

  let acc = 0n
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null
    acc = (acc << 16n) | BigInt(Number.parseInt(g, 16))
  }
  return acc
}

function parseBits(cidr: string, max: number): { network: string; bits: number } {
  const slash = cidr.lastIndexOf('/')
  if (slash === -1) throw new Error(`invalid cidr: missing /bits: ${cidr}`)
  const network = cidr.slice(0, slash)
  const bitsStr = cidr.slice(slash + 1)
  if (!/^(?:0|[1-9]\d*)$/.test(bitsStr)) throw new Error(`invalid cidr bits: ${cidr}`)
  const bits = Number(bitsStr)
  if (bits < 0 || bits > max) throw new Error(`cidr bits out of range: ${cidr}`)
  return { network, bits }
}

export function ipv4InCidr(ip: string, cidr: string): boolean {
  const { network, bits } = parseBits(cidr, 32)
  const ipNum = parseIpv4(ip)
  const netNum = parseIpv4(network)
  if (ipNum === null || netNum === null) return false
  if (bits === 0) return true
  const mask = ((1n << 32n) - 1n) ^ ((1n << BigInt(32 - bits)) - 1n)
  return (ipNum & mask) === (netNum & mask)
}

export function ipv6InCidr(ip: string, cidr: string): boolean {
  const { network, bits } = parseBits(cidr, 128)
  const ipNum = parseIpv6(ip)
  const netNum = parseIpv6(network)
  if (ipNum === null || netNum === null) return false
  if (bits === 0) return true
  const mask = ((1n << 128n) - 1n) ^ ((1n << BigInt(128 - bits)) - 1n)
  return (ipNum & mask) === (netNum & mask)
}

export function ipInCidr(ip: string, cidr: string): boolean {
  const ipIsV6 = ip.includes(':')
  const cidrIsV6 = cidr.includes(':')
  if (ipIsV6 !== cidrIsV6) return false
  return ipIsV6 ? ipv6InCidr(ip, cidr) : ipv4InCidr(ip, cidr)
}

export function assertCidr(cidr: string): void {
  const max = cidr.includes(':') ? 128 : 32
  const { network, bits } = parseBits(cidr, max)
  const netNum = cidr.includes(':') ? parseIpv6(network) : parseIpv4(network)
  if (netNum === null) throw new Error(`invalid cidr network: ${cidr}`)
  if (bits === 0) {
    throw new Error(`refuses unbounded CIDR: ${cidr} disables proxy-auth trust boundary`)
  }
}

// Any textual form of an IPv4-mapped IPv6 address (::ffff:10.0.0.1, ::ffff:a00:1,
// uppercase variants) is normalized to dotted-quad IPv4 so it matches v4 trust CIDRs.
function unmapIpv4(ip: string): string {
  if (!ip.includes(':')) return ip
  const num = parseIpv6(ip)
  if (num === null || num >> 32n !== 0xffffn) return ip
  const v4 = num & 0xffffffffn
  return [(v4 >> 24n) & 0xffn, (v4 >> 16n) & 0xffn, (v4 >> 8n) & 0xffn, v4 & 0xffn].join('.')
}

export function isIpTrusted(ip: string, cidrs: string[]): boolean {
  const cleanIp = unmapIpv4(ip)
  return cidrs.some((cidr) => ipInCidr(cleanIp, cidr))
}
