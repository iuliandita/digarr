import type { PostResult } from '../transport'
import type { AppriseChannel, WebhookPayload } from '../types'

export function sendAppriseChannel(
  _channel: AppriseChannel,
  _payload: WebhookPayload,
): Promise<PostResult> {
  return Promise.resolve({ ok: false, error: 'apprise not implemented' }) // TODO(task-4)
}
