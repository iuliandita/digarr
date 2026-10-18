import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { getJobHealth } from '../lib/api'
import { formatRelativeTime } from '../lib/format-time'
import { useI18n } from '../lib/i18n'

type HealthLevel = 'ok' | 'degraded' | 'error'

function healthLevel(status: string): HealthLevel {
  return status === 'ok' ? 'ok' : status === 'degraded' ? 'degraded' : 'error'
}

const STATUS_LABEL_KEY = {
  ok: 'systemHealth.statusOk',
  degraded: 'systemHealth.statusDegraded',
  error: 'systemHealth.statusError',
} as const

function StatusIcon({ status }: { status: string }) {
  const { t } = useI18n()
  const level = healthLevel(status)
  const color =
    level === 'ok' ? 'text-approve' : level === 'degraded' ? 'text-warning' : 'text-reject'
  const shape =
    level === 'ok' ? (
      <path d="M3.5 8.5l3 3 6-6.5" />
    ) : level === 'degraded' ? (
      <path d="M8 2.5l6 10.5H2z M8 7v2.5 M8 11.2v.1" />
    ) : (
      <path d="M4 4l8 8 M12 4l-8 8" />
    )
  return (
    <>
      <svg
        viewBox="0 0 16 16"
        className={`h-3.5 w-3.5 shrink-0 ${color}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        data-status={level}
      >
        {shape}
      </svg>
      <span className="sr-only">{t(STATUS_LABEL_KEY[level])}</span>
    </>
  )
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
    if (!iso) return t('common.notAvailable')
    const diff = new Date(iso).getTime() - Date.now()
    if (diff < 0) return t('systemHealth.overdue')
    const mins = Math.floor(diff / 60000)
    if (mins < 60) return t('systemHealth.inMinutes').replace('{0}', String(mins))
    return t('systemHealth.inHours').replace('{0}', String(Math.floor(mins / 60)))
  }

  if (isLoading || !data) {
    return (
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="h-24 animate-pulse rounded bg-surface-2" />
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
              embedded ? 'text-lead font-semibold text-text' : 'text-sm font-medium text-text'
            }
          >
            {t('systemHealth.title')}
          </h2>
        </div>
        <Link to="/settings?tab=system#jobs" className="text-xs text-accent-text underline">
          {t('systemHealth.viewHistory')}
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label={t('systemHealth.pipeline')}
          value={t(STATUS_LABEL_KEY[healthLevel(data.pipeline.status)])}
        />
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
            data.librarySync?.lastRun
              ? formatRelativeTime(locale, data.librarySync.lastRun)
              : t('common.notAvailable')
          }
        />
      </div>

      <div className="rounded-lg border border-border bg-surface">
        <div className="divide-y divide-border">
          {rows.map((row) => (
            <div key={row.key} className="flex items-start justify-between gap-4 px-4 py-3">
              <span className="flex items-center gap-2 text-sm text-text">
                <StatusIcon status={row.status} />
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
