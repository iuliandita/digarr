import { useQuery } from '@tanstack/react-query'
import { Download, Pencil, Play } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import type { MessageKey } from '@/core/i18n/messages/types'
import { Hint } from '../components/hint'
import { Skeleton } from '../components/ui/skeleton'
import {
  exportPlaylistApi,
  generatePlaylistApi,
  getPlaylist,
  type PlaylistRow,
  type PlaylistTrackRow,
} from '../lib/api'
import { useI18n } from '../lib/i18n'
import { formatShortDate } from '../lib/intl'

function formatRelativeTime(locale: string, dateStr: string | null, neverLabel: string): string {
  if (!dateStr) return neverLabel
  const date = new Date(dateStr)
  const diffMinutes = Math.round((date.getTime() - Date.now()) / 60_000)
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (Math.abs(diffMinutes) < 1) return formatter.format(0, 'second')
  if (Math.abs(diffMinutes) < 60) return formatter.format(diffMinutes, 'minute')
  const diffHours = Math.round(diffMinutes / 60)
  if (Math.abs(diffHours) < 24) return formatter.format(diffHours, 'hour')
  const diffDays = Math.round(diffHours / 24)
  if (Math.abs(diffDays) < 30) return formatter.format(diffDays, 'day')
  return formatShortDate(locale as never, date)
}

function formatSchedule(cron: string | null, t: (key: MessageKey) => string): string {
  if (!cron) return t('common.manual')
  const NAMED: Record<string, string> = {
    '0 0 * * *': t('common.daily'),
    '0 8 * * 1': t('common.everyMonday'),
    '0 8 * * 0': t('common.everySunday'),
    '0 8 * * 1,4': t('common.monThu'),
    '0 8 1,15 * *': t('common.firstAndFifteenth'),
    '0 8 1 * *': t('common.monthly'),
  }
  return NAMED[cron] ?? cron
}

const STRATEGY_BADGES: Record<string, { label: string; className: string }> = {
  audition: { label: 'playlist.strategyAudition', className: 'bg-blue-500/15 text-blue-400' },
  weekly_digest: {
    label: 'playlist.strategyWeeklyDigest',
    className: 'bg-blue-500/15 text-blue-400',
  },
  genre_focus: {
    label: 'playlist.strategyGenreFocus',
    className: 'bg-green-500/15 text-green-400',
  },
  mood_mix: { label: 'playlist.strategyMoodMix', className: 'bg-purple-500/15 text-purple-400' },
  rediscover: { label: 'playlist.strategyRediscover', className: 'bg-amber-500/15 text-amber-400' },
}

const SOURCE_BADGES: Record<string, { label: string; className: string }> = {
  local: { label: 'playlist.sourceLocal', className: 'bg-surface text-muted border border-border' },
  spotify: { label: 'playlist.sourceSpotify', className: 'bg-green-500/15 text-green-400' },
  deezer: { label: 'playlist.sourceDeezer', className: 'bg-purple-500/15 text-purple-400' },
  musicbrainz: { label: 'playlist.sourceMusicbrainz', className: 'bg-blue-500/15 text-blue-400' },
}

function detectSource(track: PlaylistTrackRow): string {
  if (track.localPath) return 'local'
  if (track.spotifyUri) return 'spotify'
  if (track.deezerId) return 'deezer'
  if (track.mbid) return 'musicbrainz'
  return 'local'
}

function DetailSkeleton() {
  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <Skeleton className="h-4 w-24" />
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-48" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-8 w-28 rounded-md" />
        <Skeleton className="h-8 w-16 rounded-md" />
      </div>
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-10 w-full rounded-lg" />
        ))}
      </div>
    </div>
  )
}

function TrackRow({ track, index }: { track: PlaylistTrackRow; index: number }) {
  const { t } = useI18n()
  const source = detectSource(track)
  const badge =
    SOURCE_BADGES[source] ??
    ({ label: source, className: 'bg-surface text-muted border border-border' } as {
      label: string
      className: string
    })

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-surface transition-colors">
      <span className="w-6 text-right text-xs text-muted shrink-0">{index + 1}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-text truncate">
          {track.trackName ?? (
            <span className="text-muted italic">{t('playlist.unknownTrack')}</span>
          )}
        </p>
        <p className="text-xs text-muted truncate">{track.artistName}</p>
      </div>
      <span className={`shrink-0 text-micro font-medium px-1.5 py-0.5 rounded ${badge.className}`}>
        {t(badge.label as never)}
      </span>
    </div>
  )
}

function PlaylistActions({
  playlist,
  onEdit,
  onRefetch,
}: {
  playlist: PlaylistRow
  onEdit: () => void
  onRefetch: () => void
}) {
  const { t } = useI18n()
  const [generating, setGenerating] = useState(false)
  const [exporting, setExporting] = useState<string | null>(null)

  async function handleGenerate() {
    setGenerating(true)
    try {
      await generatePlaylistApi(playlist.id)
      toast.success(t('playlist.generatingNamed'))
      onRefetch()
    } catch {
      toast.error(t('playlist.generateFailed'))
    } finally {
      setGenerating(false)
    }
  }

  async function handleExport(format: 'm3u' | 'xspf') {
    setExporting(format)
    try {
      await exportPlaylistApi(playlist.id, format)
      toast.success(`${format.toUpperCase()} ${t('playlist.downloaded')}`)
    } catch {
      toast.error(t('playlist.downloadFailed'))
    } finally {
      setExporting(null)
    }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        type="button"
        onClick={handleGenerate}
        disabled={generating}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/15 text-accent rounded-md text-sm font-medium hover:bg-accent/25 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
      >
        {generating ? (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-3.5 h-3.5 animate-spin"
            aria-hidden="true"
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
        ) : (
          <Play size={14} aria-hidden="true" />
        )}
        {generating ? t('playlist.generating') : t('playlist.generate')}
      </button>
      {(['m3u', 'xspf'] as const).map((format) => (
        <button
          key={format}
          type="button"
          onClick={() => handleExport(format)}
          disabled={exporting !== null}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-surface border border-border rounded-md text-sm text-muted hover:text-text transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <Download size={14} aria-hidden="true" />
          {exporting === format
            ? t('playlist.downloading')
            : `${t('playlist.download')} ${format.toUpperCase()}`}
        </button>
      ))}
      <button
        type="button"
        onClick={onEdit}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-surface border border-border rounded-md text-sm text-muted hover:text-text transition-colors"
      >
        <Pencil size={14} aria-hidden="true" />
        {t('common.edit')}
      </button>
    </div>
  )
}

// PlaylistDetailPage

export function PlaylistDetailPage() {
  const { locale, t } = useI18n()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const numId = Number(id)

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['playlists', numId],
    queryFn: () => getPlaylist(numId),
    enabled: !Number.isNaN(numId),
  })

  function handleEdit() {
    // Navigate back to playlists and trigger edit via state
    navigate('/playlists', { state: { editId: numId } })
  }

  if (isLoading) return <DetailSkeleton />

  if (error || !data) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <button
          type="button"
          onClick={() => navigate('/playlists')}
          className="text-sm text-muted hover:text-text transition-colors"
        >
          &larr; {t('playlist.backToPlaylists')}
        </button>
        <div className="py-16 text-center">
          <p className="text-muted text-sm">{t('playlist.notFound')}</p>
        </div>
      </div>
    )
  }

  const { playlist, tracks } = data
  const badge = STRATEGY_BADGES[playlist.strategy] ?? {
    label: playlist.strategy,
    className: 'bg-accent/15 text-accent',
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto pb-24 md:pb-6">
      {/* Back nav */}
      <button
        type="button"
        onClick={() => navigate('/playlists')}
        className="text-sm text-muted hover:text-text transition-colors"
      >
        &larr; {t('playlist.backToPlaylists')}
      </button>

      {/* Title + meta */}
      <div className="space-y-3">
        <div className="flex items-start gap-3 flex-wrap">
          <h1 className="text-2xl font-bold text-text leading-tight">{playlist.name}</h1>
          <span
            className={`mt-0.5 text-micro-lg font-medium px-2 py-0.5 rounded-full ${badge.className}`}
          >
            {badge.label.startsWith('playlist.') ? t(badge.label as never) : badge.label}
          </span>
        </div>
        <div className="flex flex-wrap gap-4 text-xs text-muted">
          <span>
            {t('common.schedule')}:{' '}
            <span className="text-text">{formatSchedule(playlist.schedule, t)}</span>
          </span>
          <span>
            {t('playlist.lastGenerated')}:{' '}
            <span className="text-text">
              {formatRelativeTime(locale, playlist.lastGeneratedAt, t('common.never'))}
            </span>
          </span>
          {playlist.trackCount != null && (
            <span>
              {t('playlist.tracks')}: <span className="text-text">{playlist.trackCount}</span>
            </span>
          )}
          {!playlist.enabled && (
            <span className="text-muted/60 italic">{t('common.disabled')}</span>
          )}
        </div>
      </div>

      <Hint id="playlist-detail-intro-tip" type="inline">
        {t('playlist.detailHint')}
      </Hint>

      {/* Actions */}
      <PlaylistActions playlist={playlist} onEdit={handleEdit} onRefetch={() => refetch()} />

      {/* Track listing */}
      <div className="space-y-1">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-muted uppercase tracking-wide font-semibold">
            {t('playlist.tracks')}
          </p>
          {tracks.length > 0 && (
            <span className="text-xs text-muted">{`${tracks.length} ${t('playlist.total')}`}</span>
          )}
        </div>
        {tracks.length === 0 ? (
          <div className="py-12 text-center bg-surface border border-border rounded-lg">
            <p className="text-muted text-sm">{t('playlist.noTracks')}</p>
          </div>
        ) : (
          <div className="bg-surface border border-border rounded-lg divide-y divide-border overflow-hidden">
            {tracks
              .slice()
              .sort((a, b) => a.position - b.position)
              .map((track, i) => (
                <TrackRow key={track.id} track={track} index={i} />
              ))}
          </div>
        )}
      </div>
    </div>
  )
}
