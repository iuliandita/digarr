import { useQuery } from '@tanstack/react-query'
import type { MessageKey } from '@/core/i18n/messages/types'
import { getJobHealth, type IntegrationHealth } from '../lib/api'
import { formatRelativeTime } from '../lib/format-time'
import { useI18n } from '../lib/i18n'

const KIND_LABELS: Record<IntegrationHealth['kind'], MessageKey> = {
  target: 'systemHealth.kind.target',
  library: 'systemHealth.kind.library',
  source: 'systemHealth.kind.source',
  subscription: 'systemHealth.kind.subscription',
  scrobbler: 'systemHealth.kind.scrobbler',
}

export function IntegrationHealthCard() {
  const { locale, t } = useI18n()
  // Shares the job-health query with SystemHealthCard, so no extra request.
  const { data } = useQuery({
    queryKey: ['job-health'],
    queryFn: getJobHealth,
    staleTime: 60_000,
    refetchInterval: 60_000,
  })

  if (!data) return null
  const { integrations } = data

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-medium text-text">{t('systemHealth.integrations')}</h3>
        <p className="text-xs text-muted">{t('systemHealth.integrationsHint')}</p>
      </div>
      {integrations.length === 0 ? (
        <p className="text-sm text-muted">{t('systemHealth.integrationsEmpty')}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {integrations.map((item) => (
            <li
              key={`${item.kind}:${item.name}`}
              className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
            >
              <span className="flex items-center gap-2 text-sm text-text">
                <span
                  aria-hidden="true"
                  className={`inline-block h-2 w-2 rounded-full ${
                    item.status === 'ok' ? 'bg-approve' : 'bg-reject'
                  }`}
                />
                <span>
                  {item.name}
                  <span className="ml-2 text-xs text-muted">{t(KIND_LABELS[item.kind])}</span>
                </span>
                <span className="sr-only">
                  {t(
                    item.status === 'ok'
                      ? 'systemHealth.integrationOk'
                      : 'systemHealth.integrationFailing',
                  )}
                </span>
              </span>
              <span className="text-xs text-muted sm:text-right">
                <span className="block">
                  {t('systemHealth.lastSuccess')}:{' '}
                  {formatRelativeTime(locale, item.lastSuccess, t('common.never'))}
                </span>
                {item.lastError && (
                  <span className="block break-words">
                    {t('systemHealth.lastError')}: {formatRelativeTime(locale, item.lastError.at)}
                    {item.lastError.message ? ` - ${item.lastError.message}` : ''}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
