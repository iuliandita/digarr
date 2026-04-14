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

export function isPrivateIp(address: string): boolean {
  const normalized = normalizeIp(address)
  if (/^127\./.test(normalized)) return true
  if (/^10\./.test(normalized)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(normalized)) return true
  if (/^192\.168\./.test(normalized)) return true
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(normalized)) return true
  if (/^169\.254\./.test(normalized)) return true
  if (normalized === '0.0.0.0') return true
  if (normalized === '::1') return true
  if (/^f[cd]/i.test(normalized)) return true
  if (/^fe80/i.test(normalized)) return true
  return false
}

export function isPrivateUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString)
    const hostname = normalizeIp(url.hostname)
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
