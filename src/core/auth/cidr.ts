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

function parseIpv6(ip: string): bigint | null {
  if (!ip.includes(':')) return null
  const zoneStripped = ip.split('%')[0] as string
  const parts = zoneStripped.split('::')
  if (parts.length > 2) return null

  const headRaw = parts[0] ?? ''
  const tailRaw = parts.length === 2 ? (parts[1] ?? '') : ''
  const head = headRaw === '' ? [] : headRaw.split(':')
  const tail = parts.length === 2 ? (tailRaw === '' ? [] : tailRaw.split(':')) : []

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

export function isIpTrusted(ip: string, cidrs: string[]): boolean {
  let cleanIp = ip
  if (cleanIp.startsWith('::ffff:')) {
    cleanIp = cleanIp.slice(7)
  }
  return cidrs.some((cidr) => ipInCidr(cleanIp, cidr))
}
