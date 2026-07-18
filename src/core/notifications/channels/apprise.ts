import { type PostResult, post } from '../transport'
import type { AppriseChannel, WebhookPayload } from '../types'

export function sendAppriseChannel(
  channel: AppriseChannel,
  payload: WebhookPayload,
): Promise<PostResult> {
  const urls = channel.urls
    .split(/[\n,]/)
    .map((u) => u.trim())
    .filter(Boolean)
    .join(',')
  return post(
    channel.endpoint,
    { title: 'digarr notification', body: payload.message, urls, type: 'info' },
    { allowPrivate: channel.allowPrivateTarget },
  )
}
