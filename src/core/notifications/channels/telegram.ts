import { type PostResult, post } from '../transport'
import type { TelegramChannel, WebhookPayload } from '../types'

export function sendTelegramChannel(
  channel: TelegramChannel,
  payload: WebhookPayload,
): Promise<PostResult> {
  const url = `https://api.telegram.org/bot${channel.botToken}/sendMessage`
  return post(
    url,
    { chat_id: channel.chatId, text: payload.message },
    {
      allowPrivate: channel.allowPrivateTarget,
      // The bot token lives in the URL path; the default log redactor only masks
      // query strings, so mask the /bot<token>/ segment to keep it out of logs.
      redact: (u) => u.replace(/\/bot[^/]+\//, '/bot[REDACTED]/'),
    },
  )
}
