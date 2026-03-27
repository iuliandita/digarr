import { Pencil, Play, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  deletePlaylistApi,
  generatePlaylistApi,
  type PlaylistRow,
  updatePlaylistApi,
} from '../lib/api'

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return 'Never'
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const minutes = Math.floor(diffMs / (1000 * 60))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatSchedule(cron: string | null): string {
  if (!cron) return 'Manual'
  const NAMED: Record<string, string> = {
    '0 0 * * *': 'Daily',
    '0 8 * * 1': 'Every Monday',
    '0 8 * * 0': 'Every Sunday',
    '0 8 * * 1,4': 'Mon + Thu',
    '0 8 1,15 * *': '1st + 15th',
    '0 8 1 * *': 'Monthly',
  }
  return NAMED[cron] ?? cron
}

const STRATEGY_BADGES: Record<string, { label: string; className: string }> = {
  weekly_digest: { label: 'Weekly Digest', className: 'bg-blue-500/15 text-blue-400' },
  genre_focus: { label: 'Genre Focus', className: 'bg-green-500/15 text-green-400' },
  mood_mix: { label: 'Mood Mix', className: 'bg-purple-500/15 text-purple-400' },
  rediscover: { label: 'Rediscover', className: 'bg-amber-500/15 text-amber-400' },
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
  const [generating, setGenerating] = useState(false)
  const navigate = useNavigate()

  const badge = STRATEGY_BADGES[playlist.strategy] ?? {
    label: playlist.strategy,
    className: 'bg-accent/15 text-accent',
  }

  async function handleGenerate() {
    setGenerating(true)
    try {
      await generatePlaylistApi(playlist.id)
      toast.success(`Generating "${playlist.name}"...`)
      onRefetch()
    } catch {
      toast.error('Failed to start generation')
    } finally {
      setGenerating(false)
    }
  }

  async function handleToggle(enabled: boolean) {
    try {
      await updatePlaylistApi(playlist.id, { enabled })
      onRefetch()
    } catch {
      toast.error('Failed to update playlist')
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete playlist "${playlist.name}"? This cannot be undone.`)) return
    try {
      await deletePlaylistApi(playlist.id)
      toast.success(`Deleted "${playlist.name}"`)
      onRefetch()
    } catch {
      toast.error('Failed to delete playlist')
    }
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: intentional div[role=button] -- action buttons nested inside prevent using <button>
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
          className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full ${badge.className}`}
        >
          {badge.label}
        </span>
      </div>

      {/* Meta row */}
      <div className="space-y-1 text-xs text-muted">
        <div className="flex items-center gap-3">
          <span>
            Schedule: <span className="text-text">{formatSchedule(playlist.schedule)}</span>
          </span>
          {playlist.trackCount != null && (
            <span>
              Tracks: <span className="text-text">{playlist.trackCount}</span>
            </span>
          )}
        </div>
        <div>
          Last generated:{' '}
          <span className="text-text">{formatRelativeTime(playlist.lastGeneratedAt)}</span>
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
            title="Generate now"
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
            {generating ? 'Generating...' : 'Generate'}
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="p-2 text-muted hover:text-text transition-colors"
            title="Edit playlist"
            aria-label="Edit playlist"
          >
            <Pencil size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="p-2 text-muted hover:text-reject transition-colors"
            title="Delete playlist"
            aria-label="Delete playlist"
          >
            <Trash2 size={14} aria-hidden="true" />
          </button>
        </div>

        {/* Right: enabled toggle */}
        <Toggle
          checked={playlist.enabled}
          onChange={handleToggle}
          label={playlist.enabled ? 'Disable playlist' : 'Enable playlist'}
        />
      </div>

      {!playlist.enabled && <p className="text-[11px] text-muted/60 text-center -mt-1">Disabled</p>}
    </div>
  )
}
