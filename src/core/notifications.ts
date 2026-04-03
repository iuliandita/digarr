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

export function isPrivateIp(address: string): boolean {
  if (/^127\./.test(address)) return true
  if (/^10\./.test(address)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return true
  if (/^192\.168\./.test(address)) return true
  if (/^169\.254\./.test(address)) return true
  if (address === '0.0.0.0') return true
  if (address === '::1') return true
  if (/^f[cd]/i.test(address)) return true
  if (/^fe80/i.test(address)) return true
  return false
}

export function isPrivateUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString)
    const hostname = url.hostname
    if (isPrivateIp(hostname)) return true
    // IPv6 (hostname includes brackets)
    const bare = hostname.replace(/^\[|\]$/g, '')
    if (isPrivateIp(bare)) return true
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

  // DNS rebinding mitigation: verify the resolved IP is also not private
  try {
    const hostname = new URL(url).hostname
    const { address } = await lookup(hostname)
    if (isPrivateIp(address)) {
      console.error('Webhook URL resolves to a private/internal IP address')
      return
    }
  } catch {
    console.error('Webhook URL hostname resolution failed')
    return
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)

  const safeUrl = url.replace(/:\/\/[^@]*@/, '://***@')
  const body = isDiscordWebhook(url) ? formatDiscordPayload(payload) : payload

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
