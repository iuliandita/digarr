import { useQuery } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import { Fragment, useRef, useState } from 'react'
import { useClickOutside } from '../hooks/use-click-outside'
import { getAlbums } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { hueFromName } from '../lib/utils'
import { Hint } from './hint'
import { StreamingLinks } from './streaming-links'
import { Skeleton } from './ui/skeleton'

export type Recommendation = {
  id: number
  score: number
  status: string
  aiReasoning?: string | null
  artist: {
    id: number
    name: string
    mbid?: string
    genres?: string[] | null
    imageUrl?: string | null
    logoUrl?: string | null
    streamingUrls?: Record<string, string> | null
  }
}

import { canApproveArtistToTarget, TargetIcon, targetActionLabel } from './target-utils'

type TodaysPickProps = {
  rec: Recommendation | null
  loading: boolean
  onApprove: (id: number) => void
  onReject: (id: number) => void
  onSkip: (id: number) => void
  onRunScan: () => void
  targets?: Array<{ id: number; type: string; name: string }>
  onApproveToTarget?: (recId: number, targetId: string) => void
}

export function TodaysPick({
  rec,
  loading,
  onApprove,
  onReject,
  onSkip,
  onRunScan,
  targets,
  onApproveToTarget,
}: TodaysPickProps) {
  const { t } = useI18n()
  const [imgError, setImgError] = useState(false)
  const [coverError, setCoverError] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const actionableTargets = (targets ?? []).filter((target) =>
    canApproveArtistToTarget(target.type),
  )
  const standaloneApproveTarget = actionableTargets.length === 1 ? actionableTargets[0] : undefined

  useClickOutside(dropdownRef, () => setDropdownOpen(false), dropdownOpen)

  const { data: albumData } = useQuery({
    queryKey: ['todays-pick-albums', rec?.artist.mbid],
    // biome-ignore lint/style/noNonNullAssertion: guarded by enabled
    queryFn: () => getAlbums(rec!.artist.mbid!),
    enabled: !!rec?.artist.mbid,
    staleTime: 60_000,
  })

  if (loading) {
    return (
      <div className="bg-surface border border-border rounded-lg overflow-hidden h-full">
        <Skeleton className="h-72 w-full" />
        <div className="p-4 space-y-3">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="h-3 w-3/5" />
        </div>
      </div>
    )
  }

  if (!rec) {
    return (
      <div className="bg-surface border border-border rounded-lg p-8 flex flex-col items-center justify-center text-center h-full">
        <p className="text-muted text-sm mb-3">{t('todaysPick.noPending')}</p>
        <button
          type="button"
          onClick={onRunScan}
          className="px-4 py-2 bg-accent text-accent-fg rounded text-sm font-medium hover:bg-accent/90 transition-colors"
        >
          {t('app.runScan')}
        </button>
      </div>
    )
  }

  const { artist } = rec
  const hue = hueFromName(artist.name)
  const scorePercent = Math.round(rec.score * 100)

  // Fallback chain: artist image -> first album cover (Cover Art Archive) -> gradient
  const firstAlbumId = albumData?.find((a) => a.type === 'Album')?.id
  const coverFallback = firstAlbumId
    ? `https://coverartarchive.org/release-group/${firstAlbumId}/front-500`
    : null
  const bannerUrl = (!imgError && artist.imageUrl) || coverFallback
  const hasImage = !!bannerUrl && !coverError

  const bannerStyle = hasImage
    ? {
        backgroundImage: `url(${bannerUrl})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    : { background: `hsl(${hue}, 40%, 35%)` }
  const highlightedReasoning = rec.aiReasoning
    ? (() => {
        const parts = rec.aiReasoning.split(
          new RegExp(`(${artist.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'),
        )
        let offset = 0

        return parts.map((part) => {
          const key = `${offset}:${part}`
          offset += part.length
          return part.toLowerCase() === artist.name.toLowerCase() ? (
            <span key={key} className="text-text font-semibold">
              {part}
            </span>
          ) : (
            <Fragment key={key}>{part}</Fragment>
          )
        })
      })()
    : null

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden flex flex-col">
      {/* Banner -- fills ~40% of card height */}
      <div className="relative shrink-0 h-72" style={bannerStyle}>
        {hasImage && (
          <img
            src={bannerUrl}
            alt={artist.name}
            className="sr-only"
            onError={() => {
              if (bannerUrl === artist.imageUrl) setImgError(true)
              else setCoverError(true)
            }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

        {/* Score badge */}
        <div
          className="absolute top-3 right-3 bg-black/60 backdrop-blur-sm rounded-lg px-2.5 py-1.5 flex items-baseline gap-0.5"
          role="img"
          aria-label={`${t('todaysPick.matchScore')}: ${scorePercent}%`}
        >
          <span className="text-accent text-xl font-bold leading-none">{scorePercent}</span>
          <span className="text-accent/70 text-xs font-semibold">%</span>
          <span className="text-white/50 text-micro-sm ml-1 uppercase tracking-wider">
            {t('todaysPick.match')}
          </span>
        </div>

        {/* Artist name / logo */}
        <div className="absolute bottom-3 left-4 right-4">
          {artist.logoUrl ? (
            <img
              src={artist.logoUrl}
              alt={artist.name}
              className="h-10 max-w-[70%] object-contain object-left drop-shadow-lg"
              onError={(e) => {
                e.currentTarget.style.display = 'none'
                const sibling = e.currentTarget.nextElementSibling
                if (sibling) sibling.classList.remove('hidden')
              }}
            />
          ) : null}
          <h3
            className={`text-white font-bold text-xl leading-tight drop-shadow-lg truncate${artist.logoUrl ? ' hidden' : ''}`}
          >
            {artist.name}
          </h3>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 overflow-y-auto min-h-0">
        {artist.genres && artist.genres.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {artist.genres.slice(0, 6).map((genre) => (
              <span
                key={genre}
                className="text-micro px-1.5 py-0.5 bg-bg border border-border rounded text-muted"
              >
                {genre}
              </span>
            ))}
          </div>
        )}

        {rec.aiReasoning && (
          <p className="text-xs text-muted mt-2 line-clamp-5">{highlightedReasoning}</p>
        )}

        <div className="mt-3">
          <StreamingLinks streamingUrls={artist.streamingUrls ?? null} artistName={artist.name} />
        </div>
      </div>

      {/* Hint above action buttons */}
      <div className="px-4 pt-2">
        <Hint id="todays-pick-skip-tip" type="inline">
          {t('todaysPick.skipHint')}
        </Hint>
      </div>

      {/* Action buttons */}
      <div className="px-4 pb-4 pt-2 flex gap-2 shrink-0">
        <button
          type="button"
          onClick={() => onReject(rec.id)}
          className="flex-1 py-2 text-sm font-medium text-center rounded-lg border border-reject/30 text-reject bg-reject/5 hover:bg-reject/15 transition-colors"
        >
          {t('todaysPick.reject')}
        </button>
        <button
          type="button"
          onClick={() => onSkip(rec.id)}
          className="flex-1 py-2 text-sm font-medium text-center rounded-lg border border-amber-500/30 text-amber-400 bg-amber-500/5 hover:bg-amber-500/15 transition-colors"
          title={t('todaysPick.skipTitle')}
        >
          {t('todaysPick.skip')}
        </button>
        {actionableTargets.length > 1 ? (
          <div ref={dropdownRef} className="relative flex-1">
            <div className="flex">
              <button
                type="button"
                onClick={() => onApprove(rec.id)}
                className="flex-1 py-2 text-sm font-medium text-center rounded-l-lg border border-approve/30 text-approve bg-approve/5 hover:bg-approve/15 transition-colors"
              >
                {t('todaysPick.approve')}
              </button>
              <button
                type="button"
                onClick={() => setDropdownOpen((v) => !v)}
                className="px-2 py-2 text-sm font-medium rounded-r-lg border border-l-0 border-approve/30 text-approve bg-approve/5 hover:bg-approve/15 transition-colors"
                aria-label={t('todaysPick.approveSpecificTarget')}
              >
                <ChevronDown size={14} />
              </button>
            </div>
            {dropdownOpen && (
              <div className="absolute right-0 bottom-full mb-1 z-20 rounded-lg border border-border bg-surface shadow-lg py-1 min-w-[180px]">
                {actionableTargets.map((target) => (
                  <button
                    key={target.id}
                    type="button"
                    onClick={() => {
                      onApproveToTarget?.(rec.id, `${target.type}-${target.id}`)
                      setDropdownOpen(false)
                    }}
                    className="w-full text-left px-3 py-1.5 text-sm text-text hover:bg-accent/10 flex items-center gap-2"
                  >
                    <TargetIcon type={target.type} />
                    {targetActionLabel(target.type, target.name, t)}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              if (standaloneApproveTarget?.type === 'slskd') {
                onApproveToTarget?.(
                  rec.id,
                  `${standaloneApproveTarget.type}-${standaloneApproveTarget.id}`,
                )
                return
              }

              onApprove(rec.id)
            }}
            className="flex-1 py-2 text-sm font-medium text-center rounded-lg border border-approve/30 text-approve bg-approve/5 hover:bg-approve/15 transition-colors"
          >
            {t('todaysPick.approve')}
          </button>
        )}
      </div>
    </div>
  )
}
