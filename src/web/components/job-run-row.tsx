import { useState } from 'react'
import type { JobRun } from '../lib/api'
import { formatDuration, formatRelativeTime } from '../lib/format-time'

const TYPE_LABELS: Record<string, string> = {
  pipeline: 'Pipeline scan',
  quick_discover: 'Quick discover',
  subscription: 'Subscription',
  target: 'Target',
  playlist: 'Playlist',
}

function jobDescription(job: JobRun): string {
  const meta = job.metadata ?? {}
  switch (job.type) {
    case 'pipeline':
      return meta.trigger === 'scheduled' ? 'Scheduled scan' : 'Manual scan'
    case 'quick_discover':
      return meta.seedArtist ? `Seed: ${meta.seedArtist}` : 'Quick discover'
    case 'subscription':
      return String(meta.adapterType ?? 'Subscription run')
    case 'target':
      return meta.artistName ? `${meta.action ?? 'add'} "${meta.artistName}"` : 'Target operation'
    case 'playlist':
      return String(meta.playlistName ?? 'Playlist generation')
    default:
      return job.type
  }
}

function jobStats(job: JobRun): string {
  const meta = job.metadata ?? {}
  const parts: string[] = []
  if (meta.artistsDiscovered != null) parts.push(`${meta.artistsDiscovered} discovered`)
  if (meta.artistsStored != null) parts.push(`${meta.artistsStored} stored`)
  if (meta.artistsFound != null) parts.push(`${meta.artistsFound} found`)
  if (meta.artistsNew != null) parts.push(`${meta.artistsNew} new`)
  if (meta.trackCount != null) parts.push(`${meta.trackCount} tracks`)
  return parts.join(' / ')
}

export function JobRunRow({ job }: { job: JobRun }) {
  const [expanded, setExpanded] = useState(false)

  const statusColor =
    job.status === 'completed'
      ? 'text-green-500'
      : job.status === 'failed'
        ? 'text-red-500'
        : job.status === 'stuck'
          ? 'text-amber-500'
          : 'text-blue-500'

  const statsText = jobStats(job)

  return (
    // biome-ignore lint/a11y/useSemanticElements: nested interactive elements require div wrapper
    <div
      className={`cursor-pointer border-b border-border px-4 py-3 hover:bg-surface-alt ${
        job.status === 'stuck' ? 'bg-amber-500/5' : ''
      }`}
      onClick={() => setExpanded(!expanded)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && setExpanded(!expanded)}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`font-mono text-xs ${statusColor}`}>
            {job.status === 'completed'
              ? '*'
              : job.status === 'failed'
                ? '!'
                : job.status === 'stuck'
                  ? '?'
                  : '~'}
          </span>
          <span className="text-sm font-medium text-text">{TYPE_LABELS[job.type] ?? job.type}</span>
          <span className="text-sm text-muted">{jobDescription(job)}</span>
          {job.status === 'stuck' && (
            <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-xs text-amber-600">
              stuck
            </span>
          )}
        </div>
        <div className="flex items-center gap-4 text-xs text-muted">
          <span>{formatDuration(job.durationMs)}</span>
          <span>{formatRelativeTime(job.startedAt)}</span>
        </div>
      </div>

      {statsText && <div className="mt-1 text-xs text-muted">{statsText}</div>}

      {job.sourceResults && !expanded && (
        <div className="mt-1 flex gap-2 text-xs">
          {Object.entries(job.sourceResults).map(([source, result]) => (
            <span
              key={source}
              className={
                result.status === 'ok'
                  ? 'text-green-500'
                  : result.status === 'error'
                    ? 'text-red-500'
                    : 'text-muted'
              }
            >
              {source} {result.status === 'ok' ? '*' : result.status === 'error' ? '!' : '-'}
            </span>
          ))}
        </div>
      )}

      {expanded && (
        <div className="mt-3 space-y-2 border-t border-border pt-3 text-xs">
          {job.error && (
            <div className="rounded bg-red-500/10 p-2 text-red-500">
              <strong>Error:</strong> {job.error}
            </div>
          )}
          {job.sourceResults && (
            <div>
              <strong className="text-muted">Source Results:</strong>
              <div className="mt-1 space-y-1">
                {Object.entries(job.sourceResults).map(([source, result]) => (
                  <div key={source} className="flex justify-between">
                    <span>{source}</span>
                    <span
                      className={
                        result.status === 'ok'
                          ? 'text-green-500'
                          : result.status === 'error'
                            ? 'text-red-500'
                            : 'text-muted'
                      }
                    >
                      {result.status}
                      {result.artists != null && ` (${result.artists} artists)`}
                      {result.ms != null && ` ${result.ms}ms`}
                      {result.error && ` - ${result.error}`}
                      {result.reason && ` - ${result.reason}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {Object.keys(job.metadata).length > 0 && (
            <div>
              <strong className="text-muted">Metadata:</strong>
              <pre className="mt-1 overflow-auto rounded bg-surface-alt p-2 text-xs">
                {JSON.stringify(job.metadata, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
