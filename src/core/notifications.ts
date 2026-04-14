import { lookup } from 'node:dns/promises'
import { isHttpUrl } from './validation'

export type WebhookPayload = {
  event: 'batch_complete'
  batchId: number
  stats: {
    discovered: number
    added: number
    failed: number
  }
  message: string
  timestamp: string
}

function normalizeIp(address: string): string {
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

function isDiscordWebhook(url: string): boolean {
  try {
    const u = new URL(url)
    return u.hostname.endsWith('discord.com') || u.hostname.endsWith('discordapp.com')
  } catch {
    return false
  }
}

function formatDiscordPayload(payload: WebhookPayload): Record<string, unknown> {
  const { stats, message } = payload
  return {
    embeds: [
      {
        title: 'Scan Complete',
        description: message,
        color: 0x7c3aed, // accent purple
        fields: [
          { name: 'Discovered', value: String(stats.discovered), inline: true },
          { name: 'Added', value: String(stats.added), inline: true },
          { name: 'Failed', value: String(stats.failed), inline: true },
        ],
        timestamp: payload.timestamp,
        footer: { text: 'digarr' },
      },
    ],
  }
}

export async function sendWebhook(url: string, payload: WebhookPayload): Promise<void> {
  if (!isHttpUrl(url)) {
    console.error('Webhook URL must use http:// or https://')
    return
  }
  if (isPrivateUrl(url)) {
    console.error('Webhook URL points to a private/internal address')
    return
  }

  // DNS rebinding mitigation: resolve hostname, verify the IP, then fetch using
  // the resolved IP directly to prevent TOCTOU rebinding attacks
  let resolvedAddress: string
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
    const { address } = await lookup(parsedUrl.hostname)
    if (isPrivateIp(address)) {
      console.error('Webhook URL resolves to a private/internal IP address')
      return
    }
    resolvedAddress = address
  } catch {
    console.error('Webhook URL hostname resolution failed')
    return
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)

  const safeUrl = url.replace(/:\/\/[^@]*@/, '://***@')
  const body = isDiscordWebhook(url) ? formatDiscordPayload(payload) : payload

  // Pin the resolved IP to prevent DNS rebinding between check and use.
  // For HTTPS this only works when the server accepts the IP directly;
  // most webhook targets (Discord, Slack) use SNI so we keep the original URL
  // for https:// and only pin for http://.
  const fetchUrl =
    parsedUrl.protocol === 'http:' ? url.replace(parsedUrl.hostname, resolvedAddress) : url
  const fetchHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
  if (parsedUrl.protocol === 'http:' && resolvedAddress !== parsedUrl.hostname) {
    fetchHeaders.Host = parsedUrl.hostname
  }

  try {
    const res = await fetch(fetchUrl, {
      method: 'POST',
      headers: fetchHeaders,
      body: JSON.stringify(body),
      signal: controller.signal,
      redirect: 'manual',
    })
    if (!res.ok) {
      console.error(`Webhook POST to ${safeUrl} failed: HTTP ${res.status}`)
    }
  } catch (err: unknown) {
    console.error(`Webhook POST to ${safeUrl} failed:`, err)
  } finally {
    clearTimeout(timeout)
  }
}
