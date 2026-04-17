export function isHttpUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://')
}

export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function normalizeIp(address: string): string {
  const bare =
    address
      .trim()
      .replace(/^\[|\]$/g, '')
      .toLowerCase()
      .split('%')[0] ?? ''
  if (!bare.startsWith('::ffff:')) return bare

  const mapped = bare.slice(7)
  if (/^\d+\.\d+\.\d+\.\d+$/.test(mapped)) return mapped

  const parts = mapped.split(':')
  const [highPart, lowPart] = parts
  if (
    highPart &&
    lowPart &&
    parts.length === 2 &&
    /^[0-9a-f]+$/i.test(highPart) &&
    /^[0-9a-f]+$/i.test(lowPart)
  ) {
    const high = Number.parseInt(highPart, 16)
    const low = Number.parseInt(lowPart, 16)
    return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`
  }

  return mapped
}

export function getLookupHostname(input: string | URL): string {
  const url = typeof input === 'string' ? new URL(input) : input
  return normalizeIp(url.hostname)
}

function parseIpv4(address: string): number | null {
  const parts = address.split('.')
  if (parts.length !== 4) return null

  let value = 0
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null
    const octet = Number.parseInt(part, 10)
    if (octet < 0 || octet > 255) return null
    value = (value << 8) | octet
  }

  return value >>> 0
}

function parseIpv6(address: string): number[] | null {
  if (!address.includes(':')) return null

  if (address.includes('.')) {
    const lastColon = address.lastIndexOf(':')
    if (lastColon === -1) return null

    const ipv4Tail = address.slice(lastColon + 1)
    const ipv4 = parseIpv4(ipv4Tail)
    if (ipv4 === null) return null

    const high = (ipv4 >>> 16) & 0xffff
    const low = ipv4 & 0xffff
    address = `${address.slice(0, lastColon + 1)}${high.toString(16)}:${low.toString(16)}`
  }

  const halves = address.split('::')
  if (halves.length > 2) return null

  const parseHalf = (half: string): number[] | null => {
    if (half === '') return []
    const groups = half.split(':')
    const parsed: number[] = []
    for (const group of groups) {
      if (!/^[0-9a-f]{1,4}$/i.test(group)) return null
      parsed.push(Number.parseInt(group, 16))
    }
    return parsed
  }

  const left = parseHalf(halves[0] ?? '')
  if (left === null) return null

  if (halves.length === 1) {
    return left.length === 8 ? left : null
  }

  const right = parseHalf(halves[1] ?? '')
  if (right === null) return null

  if (left.length + right.length > 8) return null
  return [...left, ...Array(8 - left.length - right.length).fill(0), ...right]
}

export function isPrivateIp(address: string): boolean {
  const normalized = normalizeIp(address)
  const ipv4 = parseIpv4(normalized)
  if (ipv4 !== null) {
    const octet1 = (ipv4 >>> 24) & 0xff
    const octet2 = (ipv4 >>> 16) & 0xff
    const octet3 = (ipv4 >>> 8) & 0xff

    if (octet1 === 0) return true
    if (octet1 === 10) return true
    if (octet1 === 127) return true
    if (octet1 === 100 && octet2 >= 64 && octet2 <= 127) return true
    if (octet1 === 169 && octet2 === 254) return true
    if (octet1 === 172 && octet2 >= 16 && octet2 <= 31) return true
    if (octet1 === 192 && octet2 === 168) return true
    if (octet1 === 192 && octet2 === 0 && octet3 === 2) return true
    if (octet1 === 198 && octet2 === 18) return true
    if (octet1 === 198 && octet2 === 19) return true
    if (octet1 === 198 && octet2 === 51 && octet3 === 100) return true
    if (octet1 === 203 && octet2 === 0 && octet3 === 113) return true
    if (octet1 >= 224) return true
    return false
  }

  const ipv6 = parseIpv6(normalized)
  if (ipv6 === null) return false

  const [
    group1 = 0,
    group2 = 0,
    group3 = 0,
    group4 = 0,
    group5 = 0,
    group6 = 0,
    group7 = 0,
    group8 = 0,
  ] = ipv6
  if (
    group1 === 0 &&
    group2 === 0 &&
    group3 === 0 &&
    group4 === 0 &&
    group5 === 0 &&
    group6 === 0 &&
    group7 === 0 &&
    group8 === 0
  ) {
    return true
  }
  if (
    group1 === 0 &&
    group2 === 0 &&
    group3 === 0 &&
    group4 === 0 &&
    group5 === 0 &&
    group6 === 0 &&
    group7 === 0 &&
    group8 === 1
  ) {
    return true
  }
  if (group1 >= 0xfc00 && group1 <= 0xfdff) return true
  if (group1 >= 0xfe80 && group1 <= 0xfebf) return true
  if (group1 >= 0xff00 && group1 <= 0xffff) return true
  if (group1 === 0x2001 && group2 === 0x0db8) return true
  return false
}

export function isPrivateUrl(urlString: string): boolean {
  try {
    const hostname = getLookupHostname(urlString)
    if (isPrivateIp(hostname)) return true
    if (hostname === 'localhost') return true
    return false
  } catch {
    return true // invalid URL = reject
  }
}

export function isCloudMetadata(url: string): boolean {
  try {
    const hostname = new URL(url).hostname
    return hostname === '169.254.169.254' || hostname === 'metadata.google.internal'
  } catch {
    return false
  }
}
