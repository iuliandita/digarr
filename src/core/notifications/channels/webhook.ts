import { redactUrlForLog } from '../../clients/http'
import { type PostResult, post } from '../transport'
import type { WebhookChannel, WebhookPayload } from '../types'

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`)
}

function redactWebhookUrl(url: string): string {
  const redacted = redactUrlForLog(url)
  try {
    const parsed = new URL(redacted)
    const host = parsed.hostname
    const isDiscordHost = hostMatches(host, 'discord.com') || hostMatches(host, 'discordapp.com')
    const isSlackHost = hostMatches(host, 'slack.com')
    if (!isDiscordHost && !isSlackHost) return redacted
    const segments = parsed.pathname.split('/')
    for (let i = segments.length - 1; i >= 0; i--) {
      if (segments[i] !== '') {
        segments[i] = '[REDACTED]'
        break
      }
    }
    return parsed.origin + segments.join('/') + parsed.search + parsed.hash
  } catch {
    return redacted
  }
}

function isDiscordWebhook(url: string): boolean {
  try {
    const u = new URL(url)
    return hostMatches(u.hostname, 'discord.com') || hostMatches(u.hostname, 'discordapp.com')
  } catch {
    return false
  }
}

export function formatDiscordPayload(payload: WebhookPayload): Record<string, unknown> {
  const accent = 0x7c3aed // accent purple
  if (payload.event === 'digest') {
    const { stats, message } = payload
    return {
      embeds: [
        {
          title: 'Digest',
          description: message,
          color: accent,
          fields: [
            { name: 'Discovered', value: String(stats.discovered), inline: true },
            { name: 'Added', value: String(stats.added), inline: true },
            { name: 'Runs', value: String(stats.runs), inline: true },
          ],
          timestamp: payload.timestamp,
          footer: { text: 'digarr' },
        },
      ],
    }
  }
  const { stats, message } = payload
  return {
    embeds: [
      {
        title: 'Scan Complete',
        description: message,
        color: accent,
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

export function sendWebhookChannel(
  channel: WebhookChannel,
  payload: WebhookPayload,
): Promise<PostResult> {
  const body = isDiscordWebhook(channel.url) ? formatDiscordPayload(payload) : payload
  return post(channel.url, body, {
    allowPrivate: channel.allowPrivateTarget,
    redact: redactWebhookUrl,
  })
}
