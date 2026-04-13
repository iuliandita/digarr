import { useState } from 'react'
import type { MessageKey } from '@/core/i18n/messages/types'
import type { JobRun } from '../lib/api'
import { formatDuration, formatRelativeTime } from '../lib/format-time'
import { useI18n } from '../lib/i18n'

const TYPE_LABEL_KEYS: Record<string, MessageKey> = {
  pipeline: 'jobHistory.pipelineScan',
  quick_discover: 'jobHistory.quickDiscoverType',
  subscription: 'jobHistory.subscriptionType',
  target: 'jobHistory.targetType',
  playlist: 'jobHistory.playlistType',
  library_sync: 'jobHistory.librarySync',
}

function jobDescription(job: JobRun, t: (key: MessageKey) => string): string {
  const meta = job.metadata ?? {}
  switch (job.type) {
    case 'pipeline':
      return meta.trigger === 'scheduled'
        ? t('jobHistory.scheduledScan')
        : t('jobHistory.manualScan')
    case 'quick_discover':
      return meta.seedArtist ? `Seed: ${meta.seedArtist}` : t('jobHistory.quickDiscoverType')
    case 'subscription':
      return String(meta.adapterType ?? t('jobHistory.subscriptionRun'))
    case 'target':
      return meta.artistName
        ? `${meta.action ?? 'add'} "${meta.artistName}"`
        : t('jobHistory.targetOperation')
    case 'playlist':
      return String(meta.playlistName ?? t('jobHistory.playlistGeneration'))
    case 'library_sync':
      return t('jobHistory.librarySync')
    default:
      return job.type
  }
}

function jobStats(job: JobRun, t: (key: MessageKey) => string): string {
  const meta = job.metadata ?? {}
  const parts: string[] = []
  if (meta.artistsDiscovered != null)
    parts.push(`${meta.artistsDiscovered} ${t('jobHistory.discovered')}`)
  if (meta.artistsStored != null) parts.push(`${meta.artistsStored} ${t('jobHistory.stored')}`)
  if (meta.artistsFound != null) parts.push(`${meta.artistsFound} ${t('common.found')}`)
  if (meta.artistsNew != null) parts.push(`${meta.artistsNew} ${t('jobHistory.new')}`)
  if (meta.trackCount != null) parts.push(`${meta.trackCount} ${t('jobHistory.tracks')}`)
  return parts.join(' / ')
}

export function JobRunRow({ job }: { job: JobRun }) {
  const { locale, t } = useI18n()
  const [expanded, setExpanded] = useState(false)
  const typeLabelKey = TYPE_LABEL_KEYS[job.type]
  const metadata = job.metadata ?? {}

  const statusColor =
    job.status === 'completed'
      ? 'text-green-500'
      : job.status === 'failed'
        ? 'text-red-500'
        : job.status === 'stuck'
          ? 'text-amber-500'
          : 'text-blue-500'

  const statsText = jobStats(job, t)

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
          <span className="text-sm font-medium text-text">
            {typeLabelKey ? t(typeLabelKey) : job.type}
          </span>
          <span className="text-sm text-muted">{jobDescription(job, t)}</span>
          {job.status === 'stuck' && (
            <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-xs text-amber-600">
              {t('jobHistory.stuckLabel')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4 text-xs text-muted">
          <span>{formatDuration(job.durationMs)}</span>
          <span>{formatRelativeTime(locale, job.startedAt)}</span>
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
              <strong>{t('jobHistory.errorLabel')}</strong> {job.error}
            </div>
          )}
          {job.sourceResults && (
            <div>
              <strong className="text-muted">{t('jobHistory.sourceResultsLabel')}</strong>
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
                      {result.artists != null && ` (${result.artists} ${t('jobHistory.artists')})`}
                      {result.ms != null && ` ${result.ms}ms`}
                      {result.error && ` - ${result.error}`}
                      {result.reason && ` - ${result.reason}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {Object.keys(metadata).length > 0 && (
            <div>
              <strong className="text-muted">{t('jobHistory.metadataLabel')}</strong>
              <pre className="mt-1 overflow-auto rounded bg-surface-alt p-2 text-xs">
                {JSON.stringify(metadata, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
