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

const SOURCE_STATUS_KEYS: Record<string, MessageKey> = {
  ok: 'jobHistory.sourceSuccess',
  error: 'service.error',
  skipped: 'jobHistory.sourceSkipped',
}
const SOURCE_REASON_KEYS: Record<string, MessageKey> = {
  unsupported_capability: 'jobHistory.sourceUnsupported',
  no_seeds: 'jobHistory.sourceNoSeeds',
  explicit_run: 'jobHistory.sourceExplicitRun',
  not_configured: 'jobHistory.sourceNotConfigured',
}

const STATUS_BADGES: Record<string, { key: MessageKey; className: string }> = {
  completed: { key: 'jobHistory.statusCompleted', className: 'bg-approve/15 text-approve' },
  failed: { key: 'jobHistory.statusFailed', className: 'bg-reject/15 text-reject' },
  stuck: { key: 'jobHistory.stuckLabel', className: 'bg-warning/20 text-warning' },
  cancelled: { key: 'jobHistory.cancelledLabel', className: 'bg-muted/20 text-muted' },
  running: { key: 'jobHistory.statusRunning', className: 'bg-info/15 text-info' },
}

// Brand names; library sync rows otherwise all read "Library Sync".
const LIBRARY_SOURCE_NAMES: Record<string, string> = {
  plex: 'Plex',
  jellyfin: 'Jellyfin',
  emby: 'Emby',
  lidarr: 'Lidarr',
  subsonic: 'Subsonic',
  navidrome: 'Navidrome',
}

function sourceLabel(
  value: string,
  keys: Record<string, MessageKey>,
  t: (key: MessageKey) => string,
): string {
  const key = Object.hasOwn(keys, value) ? keys[value] : undefined
  return key ? t(key) : value
}

function jobDescription(job: JobRun, t: (key: MessageKey) => string): string {
  const meta = job.metadata ?? {}
  switch (job.type) {
    case 'pipeline':
      return meta.trigger === 'scheduled'
        ? t('jobHistory.scheduledScan')
        : t('jobHistory.manualScan')
    case 'quick_discover':
      return meta.seedArtist
        ? t('jobHistory.seedArtist').replace('{artist}', String(meta.seedArtist))
        : t('jobHistory.quickDiscoverType')
    case 'subscription':
      return String(meta.adapterType ?? t('jobHistory.subscriptionRun'))
    case 'target':
      if (!meta.artistName) return t('jobHistory.targetOperation')
      return t(
        meta.action === 'addAlbum' ? 'jobHistory.targetAddAlbum' : 'jobHistory.targetAddArtist',
      ).replace('{artist}', String(meta.artistName))
    case 'playlist':
      return String(meta.playlistName ?? t('jobHistory.playlistGeneration'))
    case 'library_sync': {
      const source = typeof meta.source === 'string' ? meta.source : ''
      return LIBRARY_SOURCE_NAMES[source] ?? (source || t('jobHistory.librarySync'))
    }
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

  const statusBadge = STATUS_BADGES[job.status]

  const statsText = jobStats(job, t)

  return (
    // biome-ignore lint/a11y/useSemanticElements: nested interactive elements require div wrapper
    <div
      className={`cursor-pointer border-b border-border px-4 py-3 hover:bg-surface-2 ${
        job.status === 'stuck' ? 'bg-warning/5' : ''
      }`}
      onClick={() => setExpanded(!expanded)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && setExpanded(!expanded)}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`rounded px-1.5 py-0.5 text-xs ${statusBadge?.className ?? 'bg-info/15 text-info'}`}
          >
            {statusBadge ? t(statusBadge.key) : job.status}
          </span>
          <span className="text-sm font-medium text-text">
            {typeLabelKey ? t(typeLabelKey) : job.type}
          </span>
          <span className="text-sm text-muted">{jobDescription(job, t)}</span>
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
                  ? 'text-approve'
                  : result.status === 'error'
                    ? 'text-reject'
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
            <div className="rounded bg-reject/10 p-2 text-reject">
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
                          ? 'text-approve'
                          : result.status === 'error'
                            ? 'text-reject'
                            : 'text-muted'
                      }
                    >
                      {sourceLabel(result.status, SOURCE_STATUS_KEYS, t)}
                      {result.artists != null && ` (${result.artists} ${t('jobHistory.artists')})`}
                      {result.ms != null && ` ${result.ms}ms`}
                      {result.error && ` - ${result.error}`}
                      {result.reason && ` - ${sourceLabel(result.reason, SOURCE_REASON_KEYS, t)}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {Object.keys(metadata).length > 0 && (
            <div>
              <strong className="text-muted">{t('jobHistory.metadataLabel')}</strong>
              <pre className="mt-1 overflow-auto rounded bg-surface-2 p-2 text-xs">
                {JSON.stringify(metadata, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
