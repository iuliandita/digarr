import type { PostResult } from '../transport'
import type { NtfyChannel, WebhookPayload } from '../types'

export function sendNtfyChannel(
  _channel: NtfyChannel,
  _payload: WebhookPayload,
): Promise<PostResult> {
  return Promise.resolve({ ok: false, error: 'ntfy not implemented' }) // TODO(task-3)
}
