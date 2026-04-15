import { Pencil, Play, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import type { MessageKey } from '@/core/i18n/messages/types'
import {
  deletePlaylistApi,
  generatePlaylistApi,
  type PlaylistRow,
  updatePlaylistApi,
} from '../lib/api'
import { useI18n } from '../lib/i18n'
import { formatShortDate } from '../lib/intl'
import { ConfirmDialog } from './confirm-dialog'

function formatRelativeTime(locale: string, dateStr: string | null, neverLabel: string): string {
  if (!dateStr) return neverLabel
  const date = new Date(dateStr)
  const diffMinutes = Math.round((Date.now() - date.getTime()) / 60_000)
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (Math.abs(diffMinutes) < 1) return formatter.format(0, 'second')
  if (Math.abs(diffMinutes) < 60) return formatter.format(-diffMinutes, 'minute')
  const diffHours = Math.round(diffMinutes / 60)
  if (Math.abs(diffHours) < 24) return formatter.format(-diffHours, 'hour')
  const diffDays = Math.round(diffHours / 24)
  if (Math.abs(diffDays) < 30) return formatter.format(-diffDays, 'day')
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

// Toggle (inline switch)

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`shrink-0 w-9 h-5 rounded-full transition-colors relative ${
        checked ? 'bg-approve' : 'bg-border'
      }`}
    >
      <span
        className={`absolute top-0.5 w-4 h-4 rounded-full bg-bg transition-transform ${
          checked ? 'left-4' : 'left-0.5'
        }`}
      />
    </button>
  )
}

// PlaylistCard

type PlaylistCardProps = {
  playlist: PlaylistRow
  onEdit: () => void
  onRefetch: () => void
}

export function PlaylistCard({ playlist, onEdit, onRefetch }: PlaylistCardProps) {
  const { locale, t } = useI18n()
  const [generating, setGenerating] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const navigate = useNavigate()

  const badge = STRATEGY_BADGES[playlist.strategy] ?? {
    label: playlist.strategy,
    className: 'bg-accent/15 text-accent',
  }

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

  async function handleToggle(enabled: boolean) {
    try {
      await updatePlaylistApi(playlist.id, { enabled })
      onRefetch()
    } catch {
      toast.error(t('playlists.updateFailed'))
    }
  }

  async function handleDelete() {
    try {
      await deletePlaylistApi(playlist.id)
      toast.success(t('playlist.deletedNamed'))
      onRefetch()
    } catch {
      toast.error(t('playlist.deleteFailed'))
    }
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: intentional div[role=button] - action buttons nested inside prevent using <button>
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/playlists/${playlist.id}`)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') navigate(`/playlists/${playlist.id}`)
      }}
      className="bg-surface border border-border rounded-lg p-4 hover:border-accent/40 transition-colors space-y-3 cursor-pointer"
    >
      {/* Header: name + badge */}
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-text text-sm leading-snug truncate" title={playlist.name}>
          {playlist.name}
        </p>
        <span
          className={`shrink-0 text-micro-lg font-medium px-2 py-0.5 rounded-full ${badge.className}`}
        >
          {badge.label.startsWith('playlist.') ? t(badge.label as never) : badge.label}
        </span>
      </div>

      {/* Meta row */}
      <div className="space-y-1 text-xs text-muted">
        <div className="flex items-center gap-3">
          <span>
            {t('common.schedule')}:{' '}
            <span className="text-text">{formatSchedule(playlist.schedule, t)}</span>
          </span>
          {playlist.trackCount != null && (
            <span>
              {t('playlist.tracks')}: <span className="text-text">{playlist.trackCount}</span>
            </span>
          )}
        </div>
        <div>
          {t('playlist.lastGenerated')}:{' '}
          <span className="text-text">
            {formatRelativeTime(locale, playlist.lastGeneratedAt, t('common.never'))}
          </span>
        </div>
      </div>

      {/* Actions footer */}
      <div
        className="flex items-center justify-between gap-2 pt-1 border-t border-border"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="none"
      >
        {/* Left: generate + edit + delete */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-accent/15 text-accent rounded hover:bg-accent/25 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            title={t('playlist.generateNow')}
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
                className="w-3 h-3 animate-spin"
                aria-hidden="true"
              >
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            ) : (
              <Play size={12} aria-hidden="true" />
            )}
            {generating ? t('playlist.generating') : t('playlist.generate')}
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="p-2 text-muted hover:text-text transition-colors"
            title={t('playlist.edit')}
            aria-label={t('playlist.edit')}
          >
            <Pencil size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setShowDeleteConfirm(true)
            }}
            className="p-2 text-muted hover:text-reject transition-colors"
            title={t('playlist.delete')}
            aria-label={t('playlist.delete')}
          >
            <Trash2 size={14} aria-hidden="true" />
          </button>
        </div>

        {/* Right: enabled toggle */}
        <Toggle
          checked={playlist.enabled}
          onChange={handleToggle}
          label={playlist.enabled ? t('playlist.disable') : t('playlist.enable')}
        />
      </div>

      {!playlist.enabled && (
        <p className="text-micro-lg text-muted/60 text-center -mt-1">{t('common.disabled')}</p>
      )}
      {showDeleteConfirm && (
        <ConfirmDialog
          title={t('playlist.delete')}
          message={t('playlist.deleteWarning')}
          confirmLabel={t('playlist.delete')}
          onConfirm={() => {
            setShowDeleteConfirm(false)
            handleDelete()
          }}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </div>
  )
}
