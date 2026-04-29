import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { getJobHealth } from '../lib/api'
import { formatRelativeTime } from '../lib/format-time'
import { useI18n } from '../lib/i18n'

function StatusDot({ status }: { status: string }) {
  const color = status === 'ok' ? 'bg-approve' : status === 'degraded' ? 'bg-warning' : 'bg-reject'
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg/60 p-4">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-lg font-semibold text-text">{value}</div>
    </div>
  )
}

export function SystemHealthCard({ embedded = false }: { embedded?: boolean }) {
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
  const degradedSources = sourceEntries.length - healthySources

  const rows = [
    {
      key: 'pipeline',
      status: data.pipeline.status,
      label: t('systemHealth.pipeline'),
      detail: `${t('systemHealth.lastRun')} ${formatRelativeTime(locale, data.pipeline.lastRun)}${
        data.pipeline.nextRun
          ? ` · ${t('systemHealth.nextRun')} ${formatUntil(data.pipeline.nextRun)}`
          : ''
      }`,
    },
    {
      key: 'subscriptions',
      status: data.subscriptions.status,
      label: t('systemHealth.subscriptions'),
      detail: `${data.subscriptions.healthy}/${data.subscriptions.total} ${t('systemHealth.healthy')}`,
    },
    {
      key: 'playlists',
      status: data.playlists.status,
      label: t('systemHealth.playlists'),
      detail: `${t('systemHealth.lastRun')} ${formatRelativeTime(locale, data.playlists.lastRun)}`,
    },
    ...(data.librarySync
      ? [
          {
            key: 'library-sync',
            status: data.librarySync.status,
            label: t('systemHealth.librarySync'),
            detail: `${t('systemHealth.lastRun')} ${formatRelativeTime(locale, data.librarySync.lastRun)}`,
          },
        ]
      : []),
    ...(sourceEntries.length > 0
      ? [
          {
            key: 'sources',
            status: degradedSources === 0 ? 'ok' : 'degraded',
            label: t('systemHealth.sources'),
            detail:
              degradedSources === 0
                ? `${healthySources}/${sourceEntries.length} ${t('systemHealth.healthy')}`
                : `${healthySources}/${sourceEntries.length} ${t('systemHealth.healthy')} · ${sourceEntries
                    .filter(([, status]) => status !== 'ok')
                    .map(([name]) => name)
                    .join(', ')}`,
          },
        ]
      : []),
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2
            className={
              embedded
                ? 'text-sm font-semibold text-text uppercase tracking-wide'
                : 'text-sm font-medium text-text'
            }
          >
            {t('systemHealth.title')}
          </h2>
        </div>
        <Link to="/settings?tab=jobs" className="text-xs text-accent underline">
          {t('systemHealth.viewHistory')}
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label={t('systemHealth.pipeline')} value={data.pipeline.status} />
        <SummaryCard
          label={t('systemHealth.subscriptions')}
          value={`${data.subscriptions.healthy}/${data.subscriptions.total}`}
        />
        <SummaryCard
          label={t('systemHealth.sources')}
          value={`${healthySources}/${sourceEntries.length || 0}`}
        />
        <SummaryCard
          label={t('systemHealth.librarySync')}
          value={
            data.librarySync?.lastRun ? formatRelativeTime(locale, data.librarySync.lastRun) : '--'
          }
        />
      </div>

      <div className="rounded-lg border border-border bg-surface">
        <div className="divide-y divide-border">
          {rows.map((row) => (
            <div key={row.key} className="flex items-start justify-between gap-4 px-4 py-3">
              <span className="flex items-center gap-2 text-sm text-text">
                <StatusDot status={row.status} />
                {row.label}
              </span>
              <span className="text-right text-xs text-muted">{row.detail}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
