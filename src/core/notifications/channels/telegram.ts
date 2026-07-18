import type { PostResult } from '../transport'
import type { TelegramChannel, WebhookPayload } from '../types'

export function sendTelegramChannel(
  _channel: TelegramChannel,
  _payload: WebhookPayload,
): Promise<PostResult> {
  return Promise.resolve({ ok: false, error: 'telegram not implemented' }) // TODO(task-3)
}
