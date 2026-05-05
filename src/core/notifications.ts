import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import {
  formatUrlHostname,
  getLookupHostname,
  isHttpUrl,
  isPrivateIp,
  isPrivateUrl,
  normalizeIp,
} from './validation'

export { isPrivateIp, isPrivateUrl }

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
    const { address } = await lookup(getLookupHostname(parsedUrl))
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
  const fetchHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
  const fetchUrl = new URL(url)
  fetchUrl.hostname = formatUrlHostname(resolvedAddress)

  // Pin the resolved IP to prevent DNS rebinding between check and use.
  // HTTPS keeps the original hostname for SNI while connecting to the pinned IP.
  if (resolvedAddress !== parsedUrl.hostname || parsedUrl.protocol === 'https:') {
    fetchHeaders.Host = parsedUrl.host
  }

  const fetchInit: RequestInit & { tls?: { serverName: string } } = {
    method: 'POST',
    headers: fetchHeaders,
    body: JSON.stringify(body),
    signal: controller.signal,
    redirect: 'manual',
  }
  const normalizedHostname = normalizeIp(parsedUrl.hostname)
  if (parsedUrl.protocol === 'https:' && !isIpLiteral(normalizedHostname)) {
    fetchInit.tls = { serverName: normalizedHostname }
  }

  try {
    const res = await fetch(fetchUrl.toString(), fetchInit)
    if (!res.ok) {
      console.error(`Webhook POST to ${safeUrl} failed: HTTP ${res.status}`)
    }
  } catch (err: unknown) {
    console.error(`Webhook POST to ${safeUrl} failed:`, err)
  } finally {
    clearTimeout(timeout)
  }
}

function isIpLiteral(hostname: string): boolean {
  return isIP(hostname) !== 0
}
