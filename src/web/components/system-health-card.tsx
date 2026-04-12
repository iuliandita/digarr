import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { getJobHealth } from '../lib/api'
import { formatRelativeTime } from '../lib/format-time'
import { useI18n } from '../lib/i18n'

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'ok' ? 'bg-green-500' : status === 'degraded' ? 'bg-yellow-500' : 'bg-red-500'
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />
}

export function SystemHealthCard() {
  const { locale, t } = useI18n()
  const { data, isLoading } = useQuery({
    queryKey: ['job-health'],
    queryFn: getJobHealth,
    staleTime: 60_000,
    refetchInterval: 60_000,
  })

  function formatUntil(iso: string | null): string {
    if (!iso) return '--'
    const diff = new Date(iso).getTime() - Date.now()
    if (diff < 0) return t('systemHealth.overdue')
    const mins = Math.floor(diff / 60000)
    if (mins < 60) return t('systemHealth.inMinutes').replace('{0}', String(mins))
    return t('systemHealth.inHours').replace('{0}', String(Math.floor(mins / 60)))
  }

  if (isLoading || !data) {
    return (
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="h-24 animate-pulse rounded bg-surface-alt" />
      </div>
    )
  }

  const sourceEntries = Object.entries(data.sources)
  const healthySources = sourceEntries.filter(([, s]) => s === 'ok').length

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-text">{t('systemHealth.title')}</h3>
        <Link to="/settings/jobs" className="text-xs text-accent hover:underline">
          {t('systemHealth.viewHistory')}
        </Link>
      </div>
      <div className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <StatusDot status={data.pipeline.status} /> {t('systemHealth.pipeline')}
          </span>
          <span className="text-muted">
            {t('systemHealth.lastRun')} {formatRelativeTime(locale, data.pipeline.lastRun)}
            {data.pipeline.nextRun && (
              <>
                {' '}
                &middot; {t('systemHealth.nextRun')} {formatUntil(data.pipeline.nextRun)}
              </>
            )}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <StatusDot status={data.subscriptions.status} /> {t('systemHealth.subscriptions')}
          </span>
          <span className="text-muted">
            {data.subscriptions.healthy}/{data.subscriptions.total} {t('systemHealth.healthy')}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <StatusDot status={data.playlists.status} /> {t('systemHealth.playlists')}
          </span>
          <span className="text-muted">
            {t('systemHealth.lastRun')} {formatRelativeTime(locale, data.playlists.lastRun)}
          </span>
        </div>
        {sourceEntries.length > 0 && (
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <StatusDot status={healthySources === sourceEntries.length ? 'ok' : 'degraded'} />{' '}
              {t('systemHealth.sources')}
            </span>
            <span className="text-muted">
              {healthySources}/{sourceEntries.length}
              {sourceEntries.length > healthySources && (
                <>
                  {' '}
                  &middot;{' '}
                  {sourceEntries
                    .filter(([, s]) => s !== 'ok')
                    .map(([name]) => name)
                    .join(', ')}{' '}
                  {t('systemHealth.degraded')}
                </>
              )}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
