import { useQuery } from '@tanstack/react-query'
import type { MessageKey } from '@/core/i18n/messages/types'
import { getPendingPlayability } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { Notice } from './ui/notice'

export function PendingPlayabilitySummary() {
  const { t } = useI18n()
  const { data } = useQuery({
    queryKey: ['recommendations', 'playability'],
    queryFn: getPendingPlayability,
  })
  // Silent until an Audition run has actually found artists without a track.
  if (!data?.reasons || !(data.withoutTrack > 0)) return null

  const parts: [MessageKey, number][] = [
    ['discover.playability.missingSource', data.reasons.missingSource],
    ['discover.playability.noMatch', data.reasons.noMatch],
    ['discover.playability.upstreamFailure', data.reasons.upstreamFailure],
    ['discover.playability.titleOnly', data.reasons.titleOnly ?? 0],
    ['discover.playability.unknown', data.unknown],
  ]

  return (
    <Notice className="mx-6">
      <p>
        {t('discover.playability.summary')
          .replace('{count}', String(data.withoutTrack))
          .replace('{total}', String(data.pendingArtists))}
      </p>
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-muted">
        {parts
          .filter(([, count]) => count > 0)
          .map(([key, count]) => (
            <li key={key}>{t(key).replace('{count}', String(count))}</li>
          ))}
      </ul>
    </Notice>
  )
}
