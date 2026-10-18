import { decryptChannelSecrets } from '@/core/crypto'
import { resolveSupportedLocale } from '@/core/i18n/locales'
import { createTranslator } from '@/core/i18n/translator'
import type { Preferences } from '@/db/schema'
import { dispatch, type SenderMap } from './registry'

export async function notifyRequestResolved(
  requester: { preferences: Preferences | null; preferredLocale?: string | null },
  request: {
    recommendationId: number
    status: 'approved' | 'declined'
    artistName: string
    waiting?: boolean
  },
  opts: { senders?: Partial<SenderMap> } = {},
) {
  const t = createTranslator(resolveSupportedLocale(requester.preferredLocale))
  return dispatch(
    decryptChannelSecrets(requester.preferences?.channels ?? []).map((channel) => ({
      ...channel,
      allowPrivateTarget: false,
    })),
    'request_resolved',
    {
      event: 'request_resolved',
      recommendationId: request.recommendationId,
      status: request.status,
      message: t(
        request.status === 'approved'
          ? request.waiting
            ? 'notifications.requestApprovedWaiting'
            : 'notifications.requestApproved'
          : 'notifications.requestDeclined',
        request.artistName,
      ),
      timestamp: new Date().toISOString(),
    },
    opts,
  )
}
