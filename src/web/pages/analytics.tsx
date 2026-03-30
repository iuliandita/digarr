import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
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

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`
}

function statusBadge(status: string) {
  const colors: Record<string, string> = {
    completed: 'text-approve',
    running: 'text-accent',
    failed: 'text-reject',
  }
  return <span className={`text-xs font-medium ${colors[status] ?? 'text-muted'}`}>{status}</span>
}

const PAGE_SIZE = 10

function BatchHistoryTable({
  batches,
  loading,
}: {
  batches: AnalyticsBatch[] | null
  loading: boolean
}) {
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
        No batches yet. Run a scan to generate recommendations.
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
              <th className="text-left px-4 py-2.5 font-medium">Date</th>
              <th className="text-left px-4 py-2.5 font-medium">Status</th>
              <th className="text-right px-4 py-2.5 font-medium">Total</th>
              <th className="text-right px-4 py-2.5 font-medium">Approved</th>
              <th className="text-right px-4 py-2.5 font-medium">Rejected</th>
              <th className="text-right px-4 py-2.5 font-medium">Pending</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visible.map((b) => (
              <tr key={b.id} className="hover:bg-bg/50 transition-colors">
                <td className="px-4 py-2.5 text-text">{formatDate(b.createdAt)}</td>
                <td className="px-4 py-2.5">{statusBadge(b.status)}</td>
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
              Prev
            </button>
            <button
              type="button"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
              className="px-2 py-1 rounded bg-surface border border-border hover:border-accent/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function DiscoveryChart({ batches }: { batches: AnalyticsBatch[] }) {
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
              title={`${formatDate(b.createdAt)}: ${b.total} recs (${b.approved} approved)`}
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
        <span>{firstDate ? formatDate(firstDate).split(',')[0] : ''}</span>
        <span>{lastDate ? formatDate(lastDate).split(',')[0] : ''}</span>
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
        No genre data available yet.
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
              className="h-full bg-approve rounded transition-all"
              style={{ width: `${Math.round(g.approvalRate * 100)}%` }}
            />
          </div>
          <span className="text-xs text-muted w-20 text-right shrink-0">
            {pct(g.approvalRate)} of {g.count}
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
        No source data available yet.
      </div>
    )
  }

  return (
    <div className="bg-surface border border-border rounded-lg p-4 space-y-2.5">
      {sources.map((s) => (
        <div key={s.source} className="flex items-center gap-3">
          <span className="w-28 text-sm text-text truncate shrink-0" title={s.source}>
            {s.source}
          </span>
          <div className="flex-1 h-4 bg-bg rounded overflow-hidden">
            <div
              className="h-full bg-accent rounded transition-all"
              style={{ width: `${Math.round(s.approvalRate * 100)}%` }}
            />
          </div>
          <span className="text-xs text-muted w-28 text-right shrink-0">
            {pct(s.approvalRate)} / avg {Math.round(s.avgScore * 100)}
          </span>
        </div>
      ))}
    </div>
  )
}

function ScoreDistribution({ buckets }: { buckets: ScoreBucket[] }) {
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
              title={`${b.bucket}: ${b.count} recs`}
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
        aria-label="Approval rate trend chart"
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
              <title>{`${formatDate(t.createdAt).split(',')[0]}: ${pct(t.approvalRate)}`}</title>
            </circle>
          )
        })}
      </svg>
      <div className="flex justify-between mt-1.5 text-micro text-muted">
        <span>{firstDate ? formatDate(firstDate).split(',')[0] : ''}</span>
        <span>{lastDate ? formatDate(lastDate).split(',')[0] : ''}</span>
      </div>
    </div>
  )
}

function TimeToActCards({ data }: { data: TimeToAct[] }) {
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
        <p className="text-xs text-muted">Avg time to approve</p>
        <p className="text-xl font-bold text-approve">{fmt(approved?.avgDays)}</p>
        {approved && <p className="text-xs text-muted">{approved.count} approvals</p>}
      </div>
      <div className="bg-surface border border-border rounded-lg p-4 space-y-1">
        <p className="text-xs text-muted">Avg time to reject</p>
        <p className="text-xl font-bold text-reject">{fmt(rejected?.avgDays)}</p>
        {rejected && <p className="text-xs text-muted">{rejected.count} rejections</p>}
      </div>
    </div>
  )
}

export function AnalyticsPage() {
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
      <Hint id="analytics-intro-tip" type="inline">
        Track how your discovery pipeline performs over time. Higher approval rates mean Digarr is
        learning your taste well.
      </Hint>

      {/* Overview cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="Total Recs"
          value={overviewLoading ? '--' : (overview?.totalRecs ?? 0)}
          loading={overviewLoading}
        />
        <StatCard
          label="Approval Rate"
          value={overviewLoading ? '--' : pct(overview?.approvalRate ?? 0)}
          loading={overviewLoading}
        />
        <StatCard
          label="Avg Score"
          value={overviewLoading ? '--' : Math.round((overview?.avgScore ?? 0) * 100)}
          subValue="out of 100"
          loading={overviewLoading}
        />
        <StatCard
          label="Total Batches"
          value={overviewLoading ? '--' : (overview?.totalBatches ?? 0)}
          loading={overviewLoading}
        />
      </div>

      {/* Discovery over time chart */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-text uppercase tracking-wide">
          Discovery Over Time
        </h2>
        {batches && batches.length > 0 ? (
          <>
            <p className="text-xs text-muted -mt-2">Recommendations per batch (green = approved)</p>
            <DiscoveryChart batches={batches} />
          </>
        ) : (
          <div className="bg-surface border border-border rounded-lg p-6 text-center">
            <p className="text-sm text-muted">
              No discovery batches yet. Run a scan to see your history here.
            </p>
          </div>
        )}
      </div>

      {/* Batch history */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-text uppercase tracking-wide">Batch History</h2>
        <BatchHistoryTable batches={batches ?? null} loading={batchesLoading} />
      </div>

      {/* Score distribution + Approval trend + Time to act */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:items-stretch">
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-text uppercase tracking-wide">
            Score Distribution
          </h2>
          {scoreDist && scoreDist.length > 0 ? (
            <div className="flex-1">
              <ScoreDistribution buckets={scoreDist} />
            </div>
          ) : (
            <div className="flex-1 bg-surface border border-border rounded-lg p-6 text-center flex items-center justify-center">
              <p className="text-sm text-muted">No score data yet</p>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-text uppercase tracking-wide">
            Approval Rate Trend
          </h2>
          {trend && trend.length > 1 ? (
            <div className="flex-1">
              <ApprovalTrendChart trend={trend} />
            </div>
          ) : (
            <div className="flex-1 bg-surface border border-border rounded-lg p-6 text-center flex items-center justify-center">
              <p className="text-sm text-muted">Need 2+ batches to show trend</p>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-text uppercase tracking-wide">Time to Act</h2>
          {timeToAct && timeToAct.length > 0 ? (
            <div className="flex-1">
              <TimeToActCards data={timeToAct} />
            </div>
          ) : (
            <div className="flex-1 bg-surface border border-border rounded-lg p-6 text-center flex items-center justify-center">
              <p className="text-sm text-muted">
                Approve or reject recommendations to see timing data
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Genre breakdown + Source scores side by side on large screens */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-text uppercase tracking-wide">
            Top Genres by Approval Rate
          </h2>
          <GenreBreakdown genres={genres ?? null} loading={genresLoading} />
        </div>
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-text uppercase tracking-wide">
            Source Effectiveness
          </h2>
          <SourceScores sources={sources ?? null} loading={sourcesLoading} />
        </div>
      </div>
    </div>
  )
}
