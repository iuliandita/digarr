import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { MessageKey } from '@/core/i18n/messages/types'
import { Hint } from '../components/hint'
import { StatCard } from '../components/stat-card'
import { Skeleton } from '../components/ui/skeleton'
import {
  type AnalyticsBatch,
  type AnalyticsGenre,
  type AnalyticsSource,
  type ApprovalTrend,
  getAnalyticsBatches,
  getAnalyticsGenres,
  getAnalyticsOverview,
  getAnalyticsSources,
  getApprovalTrend,
  getScoreDistribution,
  getTimeToAct,
  type ScoreBucket,
  type TimeToAct,
} from '../lib/api'
import { useI18n } from '../lib/i18n'
import { formatDate, formatDateTime } from '../lib/intl'

function formatAnalyticsDate(locale: string, dateStr: string): string {
  return formatDateTime(locale as never, dateStr)
}

function formatAnalyticsShortDate(locale: string, dateStr: string): string {
  return formatDate(locale as never, dateStr, { month: 'short', day: 'numeric' })
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`
}

function statusBadge(status: string, t: (key: MessageKey) => string) {
  const colors: Record<string, string> = {
    completed: 'text-approve',
    running: 'text-accent',
    failed: 'text-reject',
  }
  const labels: Record<string, string> = {
    completed: t('analytics.statusCompleted'),
    running: t('common.running'),
    failed: t('common.failed'),
  }
  return (
    <span className={`text-xs font-medium ${colors[status] ?? 'text-muted'}`}>
      {labels[status] ?? status}
    </span>
  )
}

const PAGE_SIZE = 10

function BatchHistoryTable({
  batches,
  loading,
  locale,
}: {
  batches: AnalyticsBatch[] | null
  loading: boolean
  locale: string
}) {
  const { t } = useI18n()
  const [page, setPage] = useState(0)

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    )
  }

  if (!batches || batches.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-lg px-4 py-8 text-center text-muted text-sm">
        {t('analytics.noBatchesYet')}
      </div>
    )
  }

  const totalPages = Math.ceil(batches.length / PAGE_SIZE)
  const visible = batches.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  return (
    <div className="space-y-2">
      <div className="bg-surface border border-border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-muted text-xs uppercase tracking-wide">
              <th className="text-left px-4 py-2.5 font-medium">{t('common.date')}</th>
              <th className="text-left px-4 py-2.5 font-medium">{t('common.status')}</th>
              <th className="text-right px-4 py-2.5 font-medium">{t('common.total')}</th>
              <th className="text-right px-4 py-2.5 font-medium">{t('discover.approved')}</th>
              <th className="text-right px-4 py-2.5 font-medium">{t('discover.rejected')}</th>
              <th className="text-right px-4 py-2.5 font-medium">{t('discover.pending')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visible.map((b) => (
              <tr key={b.id} className="hover:bg-bg/50 transition-colors">
                <td className="px-4 py-2.5 text-text">
                  {formatAnalyticsDate(locale, b.createdAt)}
                </td>
                <td className="px-4 py-2.5">{statusBadge(b.status, t)}</td>
                <td className="px-4 py-2.5 text-right text-text">{b.total}</td>
                <td className="px-4 py-2.5 text-right text-approve">{b.approved}</td>
                <td className="px-4 py-2.5 text-right text-reject">{b.rejected}</td>
                <td className="px-4 py-2.5 text-right text-muted">{b.pending}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted">
          <span>
            {page * PAGE_SIZE + 1}--{Math.min((page + 1) * PAGE_SIZE, batches.length)} of{' '}
            {batches.length}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              className="px-2 py-1 rounded bg-surface border border-border hover:border-accent/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              {t('common.previous')}
            </button>
            <button
              type="button"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
              className="px-2 py-1 rounded bg-surface border border-border hover:border-accent/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              {t('common.next')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function DiscoveryChart({ batches }: { batches: AnalyticsBatch[] }) {
  const { locale, t } = useI18n()
  const recent = batches.slice(0, 20).reverse()
  const maxTotal = Math.max(...recent.map((b) => b.total), 1)
  const firstDate = recent[0]?.createdAt
  const lastDate = recent[recent.length - 1]?.createdAt

  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <div className="flex items-end gap-1 h-24">
        {recent.map((b) => {
          const h = Math.max((b.total / maxTotal) * 100, 4)
          const approvedH = b.total > 0 ? (b.approved / b.total) * h : 0
          return (
            <div
              key={b.id}
              className="flex-1 flex flex-col justify-end group relative"
              title={`${formatAnalyticsDate(locale, b.createdAt)}: ${b.total} ${t('analytics.recommendationsShort')} (${b.approved} ${t('analytics.approvedShort')})`}
            >
              <div
                className="w-full rounded-t bg-accent/30"
                style={{ height: `${h - approvedH}%` }}
              />
              <div className="w-full rounded-b bg-approve" style={{ height: `${approvedH}%` }} />
            </div>
          )
        })}
      </div>
      <div className="flex justify-between mt-2 text-micro text-muted">
        <span>{firstDate ? formatAnalyticsShortDate(locale, firstDate) : ''}</span>
        <span>{lastDate ? formatAnalyticsShortDate(locale, lastDate) : ''}</span>
      </div>
    </div>
  )
}

function GenreBreakdown({
  genres,
  loading,
}: {
  genres: AnalyticsGenre[] | null
  loading: boolean
}) {
  const { t } = useI18n()
  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-5 w-full" />
        ))}
      </div>
    )
  }

  if (!genres || genres.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-lg px-4 py-8 text-center text-muted text-sm">
        {t('analytics.noGenreData')}
      </div>
    )
  }

  return (
    <div className="bg-surface border border-border rounded-lg p-4 space-y-2.5">
      {genres.map((g) => (
        <div key={g.genre} className="flex items-center gap-3">
          <span className="w-28 text-sm text-text truncate shrink-0" title={g.genre}>
            {g.genre}
          </span>
          <div className="flex-1 h-4 bg-bg rounded overflow-hidden">
            <div
              className="h-full bg-approve rounded transition-[width] duration-300"
              style={{ width: `${Math.round(g.approvalRate * 100)}%` }}
            />
          </div>
          <span className="text-xs text-muted w-20 text-right shrink-0">
            {pct(g.approvalRate)} {t('common.of')} {g.count}
          </span>
        </div>
      ))}
    </div>
  )
}

function SourceScores({
  sources,
  loading,
}: {
  sources: AnalyticsSource[] | null
  loading: boolean
}) {
  const { t } = useI18n()
  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-5 w-full" />
        ))}
      </div>
    )
  }

  if (!sources || sources.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-lg px-4 py-8 text-center text-muted text-sm">
        {t('analytics.noSourceData')}
      </div>
    )
  }

  const SOURCE_LABELS: Record<string, Parameters<typeof t>[0]> = {
    similarity: 'analytics.source.similarity',
    aiConfidence: 'analytics.source.aiConfidence',
    feedbackBoost: 'analytics.source.feedbackBoost',
    consensus: 'analytics.source.consensus',
    genreOverlap: 'analytics.source.genreOverlap',
    popularity: 'analytics.source.popularity',
  }

  return (
    <div className="bg-surface border border-border rounded-lg p-4 space-y-2.5">
      {sources.map((s) => {
        const sourceLabelKey = SOURCE_LABELS[s.source]
        const label = sourceLabelKey ? t(sourceLabelKey) : s.source
        return (
          <div key={s.source} className="flex items-center gap-3">
            <span className="w-28 text-sm text-text truncate shrink-0" title={label}>
              {label}
            </span>
            <div className="flex-1 h-4 bg-bg rounded overflow-hidden">
              <div
                className="h-full bg-accent rounded transition-[width] duration-300"
                style={{ width: `${Math.round(s.approvalRate * 100)}%` }}
              />
            </div>
            <span className="text-xs text-muted w-28 text-right shrink-0">
              {pct(s.approvalRate)} / {t('analytics.avg')} {Math.round(s.avgScore * 100)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function ScoreDistribution({ buckets }: { buckets: ScoreBucket[] }) {
  const { t } = useI18n()
  const maxCount = Math.max(...buckets.map((b) => b.count), 1)
  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <div className="relative flex items-end gap-1 h-28">
        {buckets.map((b) => {
          const h = Math.max((b.count / maxCount) * 100, 2)
          return (
            <div
              key={b.bucket}
              className="flex-1 h-full flex flex-col justify-end"
              title={`${b.bucket}: ${b.count} ${t('analytics.recommendationsShort')}`}
            >
              <div className="w-full rounded-t bg-accent" style={{ height: `${h}%` }} />
            </div>
          )
        })}
      </div>
      <div className="flex gap-1 mt-1.5">
        {buckets.map((b) => (
          <span key={b.bucket} className="flex-1 text-center text-micro-sm text-muted truncate">
            {b.bucket.replace('%', '')}
          </span>
        ))}
      </div>
    </div>
  )
}

function ApprovalTrendChart({ trend }: { trend: ApprovalTrend[] }) {
  const { locale, t } = useI18n()
  if (trend.length < 2) return null
  const recent = trend.slice(-20)
  const firstDate = recent[0]?.createdAt
  const lastDate = recent[recent.length - 1]?.createdAt
  const points = recent
    .map((t, i) => {
      const x = (i / (recent.length - 1)) * 100
      const y = 100 - t.approvalRate * 100
      return `${x},${y}`
    })
    .join(' ')

  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="w-full h-24"
        role="img"
        aria-label={t('analytics.approvalRateTrendChart')}
      >
        <polyline
          points={points}
          fill="none"
          stroke="var(--color-approve)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
        {recent.map((t, i) => {
          const x = (i / (recent.length - 1)) * 100
          const y = 100 - t.approvalRate * 100
          return (
            <circle
              key={t.batchId}
              cx={x}
              cy={y}
              r="3"
              fill="var(--color-approve)"
              vectorEffect="non-scaling-stroke"
            >
              <title>{`${formatAnalyticsShortDate(locale, t.createdAt)}: ${pct(t.approvalRate)}`}</title>
            </circle>
          )
        })}
      </svg>
      <div className="flex justify-between mt-1.5 text-micro text-muted">
        <span>{firstDate ? formatAnalyticsShortDate(locale, firstDate) : ''}</span>
        <span>{lastDate ? formatAnalyticsShortDate(locale, lastDate) : ''}</span>
      </div>
    </div>
  )
}

function TimeToActCards({ data }: { data: TimeToAct[] }) {
  const { t } = useI18n()
  const approved = data.find((d) => d.status === 'approved')
  const rejected = data.find((d) => d.status === 'rejected')

  function fmt(days: number | undefined): string {
    if (days == null) return '--'
    if (days < 1 / 24) return `${Math.round(days * 24 * 60)}m`
    if (days < 1) return `${Math.round(days * 24)}h`
    return `${days.toFixed(1)}d`
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="bg-surface border border-border rounded-lg p-4 space-y-1">
        <p className="text-xs text-muted">{t('analytics.avgTimeToApprove')}</p>
        <p className="text-xl font-bold text-approve">{fmt(approved?.avgDays)}</p>
        {approved && (
          <p className="text-xs text-muted">
            {approved.count} {t('analytics.approvals')}
          </p>
        )}
      </div>
      <div className="bg-surface border border-border rounded-lg p-4 space-y-1">
        <p className="text-xs text-muted">{t('analytics.avgTimeToReject')}</p>
        <p className="text-xl font-bold text-reject">{fmt(rejected?.avgDays)}</p>
        {rejected && (
          <p className="text-xs text-muted">
            {rejected.count} {t('analytics.rejections')}
          </p>
        )}
      </div>
    </div>
  )
}

export function AnalyticsPage() {
  const { locale, t } = useI18n()
  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['analytics', 'overview'],
    queryFn: getAnalyticsOverview,
  })
  const { data: batches, isLoading: batchesLoading } = useQuery({
    queryKey: ['analytics', 'batches'],
    queryFn: getAnalyticsBatches,
  })
  const { data: genres, isLoading: genresLoading } = useQuery({
    queryKey: ['analytics', 'genres'],
    queryFn: getAnalyticsGenres,
  })
  const { data: sources, isLoading: sourcesLoading } = useQuery({
    queryKey: ['analytics', 'sources'],
    queryFn: getAnalyticsSources,
  })
  const { data: scoreDist } = useQuery({
    queryKey: ['analytics', 'scores'],
    queryFn: getScoreDistribution,
  })
  const { data: trend } = useQuery({
    queryKey: ['analytics', 'trend'],
    queryFn: getApprovalTrend,
  })
  const { data: timeToAct } = useQuery({
    queryKey: ['analytics', 'time-to-act'],
    queryFn: getTimeToAct,
  })

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <h1 className="sr-only">{t('analytics.title')}</h1>
      <Hint id="analytics-intro-tip" type="inline">
        {t('analytics.introTip')}
      </Hint>

      {/* Overview cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label={t('analytics.totalRecs')}
          value={overviewLoading ? '--' : (overview?.totalRecs ?? 0)}
          loading={overviewLoading}
        />
        <StatCard
          label={t('analytics.approvalRate')}
          value={overviewLoading ? '--' : pct(overview?.approvalRate ?? 0)}
          loading={overviewLoading}
        />
        <StatCard
          label={t('analytics.avgScore')}
          value={overviewLoading ? '--' : Math.round((overview?.avgScore ?? 0) * 100)}
          subValue={t('analytics.outOf100')}
          loading={overviewLoading}
        />
        <StatCard
          label={t('analytics.totalBatches')}
          value={overviewLoading ? '--' : (overview?.totalBatches ?? 0)}
          loading={overviewLoading}
        />
      </div>

      {/* Discovery over time chart */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-text uppercase tracking-wide">
          {t('analytics.discoveryOverTime')}
        </h2>
        {batches && batches.length > 0 ? (
          <>
            <p className="text-xs text-muted -mt-2">{t('analytics.recommendationsPerBatch')}</p>
            <DiscoveryChart batches={batches} />
          </>
        ) : (
          <div className="bg-surface border border-border rounded-lg p-6 text-center">
            <p className="text-sm text-muted">{t('analytics.noDiscoveryBatches')}</p>
          </div>
        )}
      </div>

      {/* Batch history */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-text uppercase tracking-wide">
          {t('analytics.batchHistory')}
        </h2>
        <BatchHistoryTable batches={batches ?? null} loading={batchesLoading} locale={locale} />
      </div>

      {/* Score distribution + Approval trend + Time to act */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:items-stretch">
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-text uppercase tracking-wide">
            {t('analytics.scoreDistribution')}
          </h2>
          {scoreDist && scoreDist.length > 0 ? (
            <div className="flex-1">
              <ScoreDistribution buckets={scoreDist} />
            </div>
          ) : (
            <div className="flex-1 bg-surface border border-border rounded-lg p-6 text-center flex items-center justify-center">
              <p className="text-sm text-muted">{t('analytics.noScoreData')}</p>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-text uppercase tracking-wide">
            {t('analytics.approvalRateTrend')}
          </h2>
          {trend && trend.length > 1 ? (
            <div className="flex-1">
              <ApprovalTrendChart trend={trend} />
            </div>
          ) : (
            <div className="flex-1 bg-surface border border-border rounded-lg p-6 text-center flex items-center justify-center">
              <p className="text-sm text-muted">{t('analytics.needMoreBatches')}</p>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-text uppercase tracking-wide">
            {t('analytics.timeToAct')}
          </h2>
          {timeToAct && timeToAct.length > 0 ? (
            <div className="flex-1">
              <TimeToActCards data={timeToAct} />
            </div>
          ) : (
            <div className="flex-1 bg-surface border border-border rounded-lg p-6 text-center flex items-center justify-center">
              <p className="text-sm text-muted">{t('analytics.noTimingData')}</p>
            </div>
          )}
        </div>
      </div>

      {/* Genre breakdown + Source scores side by side on large screens */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-text uppercase tracking-wide">
            {t('analytics.topGenresByApprovalRate')}
          </h2>
          <GenreBreakdown genres={genres ?? null} loading={genresLoading} />
        </div>
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-text uppercase tracking-wide">
            {t('analytics.sourceEffectiveness')}
          </h2>
          <SourceScores sources={sources ?? null} loading={sourcesLoading} />
        </div>
      </div>
    </div>
  )
}
