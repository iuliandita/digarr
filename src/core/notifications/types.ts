export type NotificationEvent = 'batch_complete' | 'digest'

export type WebhookPayload =
  | {
      event: 'batch_complete'
      batchId: number
      stats: { discovered: number; added: number; failed: number }
      message: string
      timestamp: string
    }
  | {
      event: 'digest'
      window: string
      stats: { discovered: number; added: number; runs: number }
      message: string
      timestamp: string
    }

type ChannelBase = {
  id: string
  enabled: boolean
  events: NotificationEvent[]
  allowPrivateTarget?: boolean
}

export type WebhookChannel = ChannelBase & { type: 'webhook'; url: string }
export type NtfyChannel = ChannelBase & {
  type: 'ntfy'
  server: string
  topic: string
  priority?: 1 | 2 | 3 | 4 | 5
  token?: string
}
export type TelegramChannel = ChannelBase & { type: 'telegram'; botToken: string; chatId: string }
export type AppriseChannel = ChannelBase & { type: 'apprise'; endpoint: string; urls: string }

export type NotificationChannel = WebhookChannel | NtfyChannel | TelegramChannel | AppriseChannel
