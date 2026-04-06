import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { getJobHealth } from '../lib/api'
import { formatRelativeTime } from '../lib/format-time'

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'ok' ? 'bg-green-500' : status === 'degraded' ? 'bg-yellow-500' : 'bg-red-500'
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />
}

function formatUntil(iso: string | null): string {
  if (!iso) return '--'
  const diff = new Date(iso).getTime() - Date.now()
  if (diff < 0) return 'overdue'
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `in ${mins}m`
  return `in ${Math.floor(mins / 60)}h`
}

export function SystemHealthCard() {
  const { data, isLoading } = useQuery({
    queryKey: ['job-health'],
    queryFn: getJobHealth,
    staleTime: 60_000,
    refetchInterval: 60_000,
  })

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
        <h3 className="text-sm font-medium text-text">System Health</h3>
        <Link to="/settings/jobs" className="text-xs text-accent hover:underline">
          View history
        </Link>
      </div>
      <div className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <StatusDot status={data.pipeline.status} /> Pipeline
          </span>
          <span className="text-muted">
            last: {formatRelativeTime(data.pipeline.lastRun)}
            {data.pipeline.nextRun && <> &middot; next: {formatUntil(data.pipeline.nextRun)}</>}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <StatusDot status={data.subscriptions.status} /> Subscriptions
          </span>
          <span className="text-muted">
            {data.subscriptions.healthy}/{data.subscriptions.total} healthy
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <StatusDot status={data.playlists.status} /> Playlists
          </span>
          <span className="text-muted">last: {formatRelativeTime(data.playlists.lastRun)}</span>
        </div>
        {sourceEntries.length > 0 && (
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <StatusDot status={healthySources === sourceEntries.length ? 'ok' : 'degraded'} />{' '}
              Sources
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
                  degraded
                </>
              )}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
