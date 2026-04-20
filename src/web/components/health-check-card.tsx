import { BookOpen, Copy, Image, Music, Search, Tag, User } from 'lucide-react'
import { useState } from 'react'
import type { HealthCheckItem, HealthCheckResult } from '../lib/api'
import { Button } from './ui/button'

const FIX_HINTS: Record<string, string> = {
  'missing-metadata': 'Triggers a metadata refresh in Lidarr for each affected artist',
  unmonitored: 'Sets all listed artists to monitored in Lidarr',
  'missing-albums': 'Triggers an album search in Lidarr for each affected artist',
  'genre-gaps': 'Triggers a metadata refresh in Lidarr to fetch genre tags',
  'image-gaps':
    'Looks up artist images via Lidarr and saves them locally. Some artists may not have images available on fanart.tv.',
  'missing-wikidata':
    'Fetches short descriptions and external links from Wikidata for each affected artist. Rate limited at 1 request per second.',
}

// Per-check i18n keys used by the (future) localised overrides of the backend's
// hardcoded English CHECK_META.name/description strings. Referenced here so the
// i18n-check orphan detector sees them.
export const HEALTH_CHECK_I18N_KEYS = [
  'libraryHealth.artistsMissingWikidata.title',
  'libraryHealth.artistsMissingWikidata.description',
] as const

const CHECK_ICONS: Record<string, React.ReactNode> = {
  'missing-metadata': <Search size={16} className="text-muted shrink-0" />,
  unmonitored: <User size={16} className="text-muted shrink-0" />,
  'missing-albums': <Music size={16} className="text-muted shrink-0" />,
  'duplicate-artists': <Copy size={16} className="text-muted shrink-0" />,
  'genre-gaps': <Tag size={16} className="text-muted shrink-0" />,
  'image-gaps': <Image size={16} className="text-muted shrink-0" />,
  'missing-wikidata': <BookOpen size={16} className="text-muted shrink-0" />,
}

function severityBorderClass(severity: HealthCheckResult['severity']): string {
  switch (severity) {
    case 'error':
      return 'border-l-reject'
    case 'warning':
      return 'border-l-yellow-500'
    case 'info':
      return 'border-l-accent'
  }
}

function severityBadgeClass(severity: HealthCheckResult['severity']): string {
  switch (severity) {
    case 'error':
      return 'bg-reject/15 text-reject'
    case 'warning':
      return 'bg-yellow-500/15 text-yellow-500'
    case 'info':
      return 'bg-accent/15 text-accent'
  }
}

type Props = {
  check: HealthCheckResult
  onFix: (checkId: string) => void
  fixing: boolean
  lidarrBaseUrl?: string | null
}

const PREVIEW_COUNT = 5

export function HealthCheckCard({ check, onFix, fixing, lidarrBaseUrl }: Props) {
  const [expanded, setExpanded] = useState(false)

  const visibleItems: HealthCheckItem[] = expanded
    ? check.items
    : check.items.slice(0, PREVIEW_COUNT)
  const hasMore = check.items.length > PREVIEW_COUNT
  const fixDisabled = fixing || check.count === 0 || !check.fixable

  return (
    <div
      className={`bg-surface border border-border border-l-4 ${severityBorderClass(check.severity)} rounded-lg p-4 flex flex-col gap-3`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-text flex items-center gap-1.5">
            {CHECK_ICONS[check.id]}
            {check.name}
          </p>
          <p className="text-xs text-muted mt-0.5">{check.description}</p>
        </div>
        <span
          className={`shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full ${severityBadgeClass(check.severity)}`}
        >
          {check.count}
        </span>
      </div>

      {/* Item list */}
      {visibleItems.length > 0 && (
        <div className="bg-bg border border-border rounded divide-y divide-border text-xs">
          {visibleItems.map((item) => (
            <div
              key={`${item.mbid}-${item.artistId}`}
              className="flex items-center justify-between gap-2 px-3 py-2"
            >
              {lidarrBaseUrl ? (
                <a
                  href={`${lidarrBaseUrl.replace(/\/$/, '')}/artist/${item.mbid}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-accent underline truncate"
                  onClick={(e) => e.stopPropagation()}
                >
                  {item.artistName}
                </a>
              ) : (
                <span className="font-medium text-text truncate">{item.artistName}</span>
              )}
              <span className="text-muted text-right shrink-0 max-w-[55%] truncate">
                {item.detail}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Show all / collapse toggle */}
      {hasMore && (
        <button
          type="button"
          className="text-xs text-accent underline text-left w-fit"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Show less' : `Show all ${check.count}`}
        </button>
      )}

      {/* Fix button + hint */}
      {check.fixable && (
        <div className="pt-1 space-y-1.5">
          {FIX_HINTS[check.id] && (
            <p className="text-xs text-muted italic">{FIX_HINTS[check.id]}</p>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={fixDisabled}
            onClick={() => onFix(check.id)}
            className="text-xs"
          >
            {fixing ? 'Fixing...' : 'Fix'}
          </Button>
        </div>
      )}
    </div>
  )
}
