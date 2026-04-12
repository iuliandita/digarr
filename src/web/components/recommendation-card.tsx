import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Music, Pause, Play } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { MessageKey } from '@/core/i18n/messages/types'
import { useClickOutside } from '../hooks/use-click-outside'
import { getArtistTopTracks } from '../lib/api'
import { GENRE_COLORS } from '../lib/constants'
import { useI18n } from '../lib/i18n'
import { usePreviewContext } from '../lib/preview-context'
import { cn, hueFromName } from '../lib/utils'
import { ArtistThumb } from './artist-thumb'
import { Hint } from './hint'
import { LibraryAlbumCoverageBadge } from './library-album-coverage-badge'
import { StreamingLinks } from './streaming-links'
import { Button } from './ui/button'

export type Recommendation = {
  id: number
  score: number
  status: string
  aiReasoning: string | null
  sources: Record<string, number> | null
  lidarrError: string | null
  targetActions?: Record<string, { status?: string; error?: string } | null> | null
  recommendedReleaseGroupId: string | null
  recommendedReleaseGroupTitle: string | null
  artist: {
    id: number
    name: string
    mbid: string
    disambiguation: string | null
    genres: string[] | null
    tags: string[] | null
    imageUrl: string | null
    logoUrl?: string | null
    streamingUrls: Record<string, string> | null
    beginYear?: number | null
    endYear?: number | null
  }
}

type RecommendationCardProps = {
  recommendation: Recommendation
  onApprove: (id: number) => void
  onReject: (id: number) => void
  onClick?: (id: number) => void
  isSelected?: boolean
  expanded?: boolean
  onRetry?: (id: number) => void
  bulkMode?: boolean
  isChecked?: boolean
  onToggleSelect?: (id: number) => void
  warmStatus?: 'warm' | 'warming' | 'unknown'
  approveNode?: React.ReactNode
  targets?: Array<{ id: number; type: string; name: string }>
  onApproveToTarget?: (recId: number, targetId: string) => void
}

const SOURCE_COLORS: Record<string, { label: string; color: string }> = {
  listenbrainz: { label: 'LB', color: 'var(--color-svc-listenbrainz)' },
  lastfm: { label: 'LFM', color: 'var(--color-svc-lastfm)' },
  musicbrainz: { label: 'MB', color: 'var(--color-svc-musicbrainz)' },
  ai: { label: 'Rec', color: 'var(--color-svc-ai)' },
}

const SUBSCRIPTION_COLORS: Record<string, string> = {
  'genre-subscription': 'bg-indigo-500/20 text-indigo-400',
  'similar-subscription': 'bg-violet-500/20 text-violet-400',
  'spotify-playlist': 'bg-green-500/20 text-green-400',
  'spotify-charts': 'bg-green-500/20 text-green-400',
  'lastfm-tag': 'bg-red-500/20 text-red-400',
  'lastfm-charts': 'bg-red-500/20 text-red-400',
  listenbrainz: 'bg-orange-500/20 text-orange-400',
}

const SLSKD_STATUS_LABELS: Partial<Record<string, MessageKey>> = {
  queued: 'recommendation.slskdQueued',
  downloading: 'recommendation.slskdDownloading',
  import_pending: 'recommendation.slskdImportPending',
  needs_review: 'recommendation.slskdNeedsReview',
}

function getSourceBadgeClass(sourceKey: string): string {
  const prefix = sourceKey.split(':')[0] ?? sourceKey
  return SUBSCRIPTION_COLORS[prefix] ?? 'bg-zinc-500/20 text-zinc-400'
}

function formatSourceLabel(sourceKey: string, t: (key: MessageKey) => string): string {
  const [type, detail] = sourceKey.split(':')
  switch (type) {
    case 'genre-subscription':
      return `${t('recommendation.sourceGenre')}: ${detail}`
    case 'similar-subscription':
      return `${t('recommendation.sourceSimilar')}: ${detail}`
    case 'spotify-playlist':
      return t('recommendation.sourceSpotifyPlaylist')
    case 'spotify-charts':
      return t('recommendation.sourceSpotifyCharts')
    case 'lastfm-tag':
      return `${t('recommendation.sourceLastfm')}: ${detail}`
    case 'lastfm-charts':
      return t('recommendation.sourceLastfmCharts')
    case 'listenbrainz':
      return t('recommendation.sourceListenBrainz')
    default:
      return sourceKey
  }
}

function StatusBadge({
  status,
  lidarrError,
  targetActions,
  onRetry,
  id,
}: {
  status: string
  lidarrError: string | null
  targetActions?: Record<string, { status?: string; error?: string } | null> | null
  onRetry?: (id: number) => void
  id: number
}) {
  const { t } = useI18n()
  const failedTargetError = Object.values(targetActions ?? {}).find(
    (action) =>
      action?.status === 'failed' && typeof action.error === 'string' && action.error.length > 0,
  )?.error
  const slskdStatus = Object.entries(targetActions ?? {}).find(([targetId, action]) => {
    return targetId.startsWith('slskd-') && typeof action?.status === 'string'
  })?.[1]?.status
  const slskdStatusLabel = slskdStatus ? SLSKD_STATUS_LABELS[slskdStatus] : undefined

  if (status === 'added_to_lidarr') {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-approve font-medium">
          {t('recommendation.addedToLidarr')}
        </span>
        {slskdStatusLabel && (
          <span className="text-xs text-accent font-medium">{t(slskdStatusLabel)}</span>
        )}
        {failedTargetError && (
          <span className="text-xs text-muted truncate max-w-[200px]" title={failedTargetError}>
            {failedTargetError}
          </span>
        )}
      </div>
    )
  }
  if (status === 'rejected') {
    return <span className="text-xs text-reject font-medium">{t('recommendation.rejected')}</span>
  }
  if (status === 'add_failed') {
    const errorMessage = lidarrError ?? failedTargetError
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-reject font-medium">{t('recommendation.addFailed')}</span>
        {errorMessage && (
          <span className="text-xs text-muted truncate max-w-[200px]" title={errorMessage}>
            {errorMessage}
          </span>
        )}
        {onRetry && (
          <button
            type="button"
            onClick={() => onRetry(id)}
            className="text-xs text-accent hover:underline"
          >
            {t('recommendation.retry')}
          </button>
        )}
      </div>
    )
  }
  if (slskdStatusLabel) {
    return <span className="text-xs text-accent font-medium">{t(slskdStatusLabel)}</span>
  }
  return null
}

function GenrePills({
  genres,
  max = 4,
  compact = false,
}: {
  genres: string[] | null
  max?: number
  compact?: boolean
}) {
  if (!genres || genres.length === 0) return null
  const shown = genres.slice(0, max)
  return (
    <div className={cn('flex gap-1', compact ? 'overflow-hidden' : 'flex-wrap')}>
      {shown.map((g, i) => (
        <span
          key={g}
          className={cn(
            'text-micro px-1.5 py-0.5 rounded-full shrink-0',
            GENRE_COLORS[i % GENRE_COLORS.length],
          )}
        >
          {g}
        </span>
      ))}
      {genres.length > max && (
        <span className="text-micro px-1.5 py-0.5 rounded-full bg-surface text-muted shrink-0">
          +{genres.length - max}
        </span>
      )}
    </div>
  )
}

import { canApproveArtistToTarget, TargetIcon, targetActionLabel } from './target-utils'

function ApproveDropdown({
  recId,
  targets,
  onApprove,
  onApproveToTarget,
}: {
  recId: number
  targets: Array<{ id: number; type: string; name: string }>
  onApprove: (id: number) => void
  onApproveToTarget?: (recId: number, targetId: string) => void
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => setOpen(false), open)
  const actionableTargets = targets.filter((target) => canApproveArtistToTarget(target.type))

  return (
    <div ref={ref} className="relative">
      <div className="flex">
        <Button
          size="sm"
          variant="outline"
          className="text-approve border-approve/40 hover:bg-approve/10 hover:text-approve rounded-r-none"
          onClick={(e) => {
            e.stopPropagation()
            onApprove(recId)
          }}
        >
          {t('recommendation.approve')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="text-approve border-approve/40 hover:bg-approve/10 hover:text-approve rounded-l-none border-l-0 px-1.5"
          onClick={(e) => {
            e.stopPropagation()
            setOpen(!open)
          }}
        >
          <ChevronDown size={14} />
        </Button>
      </div>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-10 rounded-lg border border-border bg-surface shadow-lg py-1 min-w-[180px]">
          {actionableTargets.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onApproveToTarget?.(recId, `${t.type}-${t.id}`)
                setOpen(false)
              }}
              className="w-full text-left px-3 py-1.5 text-sm text-text hover:bg-accent/10 flex items-center gap-2"
            >
              <TargetIcon type={t.type} />
              {targetActionLabel(t.type, t.name)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Action buttons (shared between compact and expanded views)

function ActionButtons({
  rec,
  bulkMode,
  isPending,
  isApproved,
  onApprove,
  onReject,
  approveNode,
  targets,
  onApproveToTarget,
}: {
  rec: Recommendation
  bulkMode: boolean
  isPending: boolean
  isApproved: boolean
  onApprove: (id: number) => void
  onReject: (id: number) => void
  approveNode?: React.ReactNode
  targets?: Array<{ id: number; type: string; name: string }>
  onApproveToTarget?: (recId: number, targetId: string) => void
}) {
  const { t } = useI18n()
  if (bulkMode) return null
  const actionableTargets = (targets ?? []).filter((target) =>
    canApproveArtistToTarget(target.type),
  )
  const standaloneApproveTarget = actionableTargets.length === 1 ? actionableTargets[0] : undefined
  const isStandaloneSlskdTarget = standaloneApproveTarget?.type === 'slskd'

  function stop(e: React.MouseEvent | React.KeyboardEvent) {
    e.stopPropagation()
  }

  if (isPending) {
    return (
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          className="text-reject border-reject/40 hover:bg-reject/10 hover:text-reject"
          onClick={(e) => {
            stop(e)
            onReject(rec.id)
          }}
        >
          {t('recommendation.reject')}
        </Button>
        {approveNode ??
          (actionableTargets.length > 1 ? (
            <ApproveDropdown
              recId={rec.id}
              targets={actionableTargets}
              onApprove={onApprove}
              onApproveToTarget={onApproveToTarget}
            />
          ) : isStandaloneSlskdTarget && standaloneApproveTarget ? (
            <Button
              size="sm"
              variant="outline"
              className="text-approve border-approve/40 hover:bg-approve/10 hover:text-approve"
              onClick={(e) => {
                stop(e)
                onApproveToTarget?.(
                  rec.id,
                  `${standaloneApproveTarget.type}-${standaloneApproveTarget.id}`,
                )
              }}
            >
              {t('recommendation.approve')}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="text-approve border-approve/40 hover:bg-approve/10 hover:text-approve"
              onClick={(e) => {
                stop(e)
                onApprove(rec.id)
              }}
            >
              {t('recommendation.approve')}
            </Button>
          ))}
      </div>
    )
  }
  if (isApproved) {
    return (
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          className="text-reject border-reject/40 hover:bg-reject/10 hover:text-reject"
          onClick={(e) => {
            stop(e)
            onReject(rec.id)
          }}
        >
          {t('recommendation.reject')}
        </Button>
      </div>
    )
  }
  if (rec.status === 'rejected') {
    return (
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          className="text-muted border-border/60 hover:bg-surface hover:text-text"
          onClick={(e) => {
            stop(e)
            onApprove(rec.id)
          }}
        >
          {t('recommendation.restore')}
        </Button>
      </div>
    )
  }
  return null
}

function TopTracks({ artistId }: { artistId: number }) {
  const { t } = useI18n()
  const preview = usePreviewContext()
  const { data, isLoading } = useQuery({
    queryKey: ['top-tracks', artistId],
    queryFn: () => getArtistTopTracks(artistId),
    staleTime: 5 * 60 * 1000,
  })

  const [playingUrl, setPlayingUrl] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const lastGlobalPlayIdRef = useRef(preview.globalPlayId)

  function handlePlay(previewUrl: string) {
    if (playingUrl === previewUrl) {
      audioRef.current?.pause()
      setPlayingUrl(null)
      return
    }
    // Clean up previous audio element fully
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.onended = null
      audioRef.current.onerror = null
      audioRef.current.src = ''
    }
    // Stop global preview when playing a track
    preview.stop()
    // Use proxy URL with token in query param (Audio element can't send headers)
    const token = localStorage.getItem('digarr-auth-token')
    const params = new URLSearchParams({ url: previewUrl })
    if (token) params.set('token', token)
    const proxyUrl = `/api/preview/audio?${params.toString()}`
    const audio = new Audio(proxyUrl)
    audioRef.current = audio
    audio.onended = () => setPlayingUrl(null)
    audio.onerror = () => {
      setPlayingUrl(null)
      toast.error(t('recommendation.audioUnavailable'))
    }
    audio.play().catch(() => {
      setPlayingUrl(null)
      toast.error(t('recommendation.audioUnavailable'))
    })
    setPlayingUrl(previewUrl)
  }

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.onended = null
        audioRef.current.onerror = null
        audioRef.current.src = ''
      }
    }
  }, [])

  // Stop local audio when global preview starts
  useEffect(() => {
    if (preview.globalPlayId === lastGlobalPlayIdRef.current) return
    lastGlobalPlayIdRef.current = preview.globalPlayId
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = ''
      setPlayingUrl(null)
    }
  }, [preview.globalPlayId])

  const tracks = data?.tracks ?? []

  if (isLoading) {
    return (
      <div className="space-y-2 mt-3">
        <div className="text-xs font-medium text-muted">{t('recommendation.topTracks')}</div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-4 bg-surface rounded animate-pulse w-3/4" />
        ))}
      </div>
    )
  }

  if (tracks.length === 0) return null

  return (
    <div className="space-y-1.5 mt-3">
      <div className="text-xs font-medium text-muted">{t('recommendation.topTracks')}</div>
      {tracks.map((track) => (
        <div key={track.name} className="flex items-center gap-2 text-sm">
          {track.previewUrl ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                if (track.previewUrl) handlePlay(track.previewUrl)
              }}
              className="text-accent hover:text-accent/80 transition-colors shrink-0 w-4 text-center"
              aria-label={
                playingUrl === track.previewUrl
                  ? t('recommendation.stopPreview')
                  : t('recommendation.playPreview')
              }
            >
              {playingUrl === track.previewUrl ? (
                <Pause className="w-3 h-3" />
              ) : (
                <Play className="w-3 h-3" />
              )}
            </button>
          ) : (
            <span className="text-muted shrink-0 w-4 text-center">
              <Music className="w-3 h-3" />
            </span>
          )}
          <span className="text-text truncate">{track.name}</span>
          {track.durationMs != null && (
            <span className="text-muted text-xs ml-auto shrink-0">
              {Math.floor(track.durationMs / 60000)}:
              {String(Math.floor((track.durationMs % 60000) / 1000)).padStart(2, '0')}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

export function RecommendationCard({
  recommendation: rec,
  onApprove,
  onReject,
  onClick,
  isSelected = false,
  expanded = false,
  onRetry,
  bulkMode = false,
  isChecked = false,
  onToggleSelect,
  warmStatus,
  approveNode,
  targets,
  onApproveToTarget,
}: RecommendationCardProps) {
  const { t } = useI18n()
  const preview = usePreviewContext()
  const pct = `${Math.round(rec.score * 100)}%`
  const isPending = rec.status === 'pending' || rec.status === 'approved'
  const isActed = rec.status !== 'pending'
  const isApproved =
    rec.status === 'added_to_lidarr' || rec.status === 'add_failed' || rec.status === 'approved'
  const artistIsPlaying = preview.playing && preview.currentMbid === rec.artist.mbid
  const hasPreview = preview.hasPreview(rec.artist.streamingUrls)

  function handlePlayClick(e: React.MouseEvent) {
    e.stopPropagation()
    preview.play(rec.artist.mbid, rec.artist.name, rec.artist.streamingUrls)
  }

  function handlePlayFromLinks() {
    preview.play(rec.artist.mbid, rec.artist.name, rec.artist.streamingUrls)
  }

  function handleCardClick() {
    if (bulkMode) {
      onToggleSelect?.(rec.id)
    } else {
      onClick?.(rec.id)
    }
  }

  return (
    <div className="relative group">
      {/* Bulk mode checkbox overlay */}
      {bulkMode && (
        <button
          type="button"
          className="absolute top-2 left-2 z-20 bg-transparent border-none p-0"
          onClick={(e) => {
            e.stopPropagation()
            onToggleSelect?.(rec.id)
          }}
        >
          <input
            type="checkbox"
            checked={isChecked}
            onChange={() => onToggleSelect?.(rec.id)}
            className="w-4 h-4 accent-accent cursor-pointer"
            aria-label={`${t('recommendation.select')} ${rec.artist.name}`}
            tabIndex={-1}
          />
        </button>
      )}
      {/* Hover edge buttons -- desktop only, pending cards, not when expanded */}
      {!bulkMode && isPending && !expanded && (
        <>
          {/* Left edge: reject */}
          <button
            type="button"
            className="hidden md:group-hover:flex absolute left-0 top-0 bottom-0 z-10 items-center justify-center w-10 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-all duration-150 bg-transparent border-none p-0"
            onClick={(e) => {
              e.stopPropagation()
              onReject(rec.id)
            }}
            aria-label={t('recommendation.reject')}
          >
            <span className="w-8 h-8 rounded-full bg-surface/90 backdrop-blur-sm border border-reject/40 text-reject hover:bg-reject/30 transition-colors flex items-center justify-center shadow-lg">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-4 h-4"
                aria-hidden="true"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </span>
          </button>
          {/* Right edge: approve */}
          <button
            type="button"
            className="hidden md:group-hover:flex absolute right-0 top-0 bottom-0 z-10 items-center justify-center w-10 translate-x-1/2 opacity-0 group-hover:opacity-100 transition-all duration-150 bg-transparent border-none p-0"
            onClick={(e) => {
              e.stopPropagation()
              onApprove(rec.id)
            }}
            aria-label={t('recommendation.approve')}
          >
            <span className="w-8 h-8 rounded-full bg-surface/90 backdrop-blur-sm border border-approve/40 text-approve hover:bg-approve/30 transition-colors flex items-center justify-center shadow-lg">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-4 h-4"
                aria-hidden="true"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
          </button>
        </>
      )}
      {/* biome-ignore lint/a11y/useSemanticElements: intentional div[role=button] -- nesting <button> inside <button> is invalid HTML */}
      <div
        role="button"
        tabIndex={0}
        data-testid="rec-card-button"
        className={cn(
          'bg-surface border rounded-lg transition-all cursor-pointer w-full text-left flex flex-col relative',
          bulkMode && isChecked
            ? 'border-accent bg-accent/5'
            : isSelected
              ? 'border-accent'
              : 'border-border hover:border-border/80',
        )}
        onClick={handleCardClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            handleCardClick()
          }
        }}
      >
        {/* Compact layout (always shown) */}
        <div className="p-4 space-y-3 flex-1">
          {/* Header row */}
          <div className="flex items-start gap-3">
            <ArtistThumb
              name={rec.artist.name}
              imageUrl={rec.artist.imageUrl}
              size={expanded ? 14 : 10}
            />
            <div className="flex-1 min-w-0 flex items-start justify-between gap-2">
              <div>
                <h3 className="text-lg font-semibold text-text leading-tight">{rec.artist.name}</h3>
                {rec.artist.disambiguation && (
                  <p className="text-xs text-muted mt-0.5">{rec.artist.disambiguation}</p>
                )}
                {rec.recommendedReleaseGroupTitle && (
                  <p className="text-xs text-muted mt-0.5">
                    {t('recommendation.startWith')}:{' '}
                    <span className="italic">{rec.recommendedReleaseGroupTitle}</span>
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {warmStatus === 'warm' && (
                  <span
                    className="w-2 h-2 rounded-full bg-green-500"
                    title={t('recommendation.metadataCached')}
                    role="img"
                    aria-label={t('recommendation.metadataCached')}
                  />
                )}
                {warmStatus === 'warming' && (
                  <span
                    className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse"
                    title={t('recommendation.warmingCache')}
                    role="img"
                    aria-label={t('recommendation.warmingCache')}
                  />
                )}
                <span className="bg-accent/20 text-accent text-xs font-semibold px-2 py-0.5 rounded">
                  {pct}
                </span>
              </div>
            </div>
          </div>

          {/* Genre tags */}
          <div className="flex items-center gap-1.5 overflow-hidden">
            <GenrePills genres={rec.artist.genres} max={expanded ? 8 : 3} compact={!expanded} />
          </div>

          {/* Streaming links (compact) + play button */}
          {!expanded && (
            <div className="flex items-center gap-2">
              {hasPreview && !bulkMode && (
                <button
                  type="button"
                  aria-label={
                    artistIsPlaying
                      ? t('recommendation.stopPreview')
                      : t('recommendation.playPreview')
                  }
                  onClick={handlePlayClick}
                  className="shrink-0 text-muted hover:text-text transition-colors"
                >
                  {artistIsPlaying ? (
                    <Pause size={14} aria-hidden="true" />
                  ) : (
                    <Play size={14} aria-hidden="true" />
                  )}
                </button>
              )}
              <StreamingLinks
                streamingUrls={rec.artist.streamingUrls}
                artistName={rec.artist.name}
                compact
              />
            </div>
          )}

          {/* Status for acted-on recs */}
          {isActed && (
            <StatusBadge
              status={rec.status}
              lidarrError={rec.lidarrError}
              targetActions={rec.targetActions}
              onRetry={onRetry}
              id={rec.id}
            />
          )}

          {rec.artist.mbid && <LibraryAlbumCoverageBadge artistMbid={rec.artist.mbid} />}

          {/* Action buttons -- compact mode only, hidden in bulk mode */}
          {!expanded && (
            <>
              <ActionButtons
                rec={rec}
                bulkMode={bulkMode}
                isPending={isPending}
                isApproved={isApproved}
                onApprove={onApprove}
                onReject={onReject}
                approveNode={approveNode}
                targets={targets}
                onApproveToTarget={onApproveToTarget}
              />
              <Hint id="rec-card-click-tip" type="inline">
                {t('recommendation.clickHint')}
              </Hint>
            </>
          )}
        </div>

        {/* Expanded-only section */}
        {expanded && (
          <div className="border-t border-border pb-4 space-y-4">
            {/* Hero banner with artist image or gradient fallback */}
            <div
              className="relative h-40 w-full bg-cover bg-center"
              style={
                rec.artist.imageUrl
                  ? { backgroundImage: `url(${rec.artist.imageUrl.replace(/[()'"]/g, '')})` }
                  : {
                      background: `hsl(${hueFromName(rec.artist.name)}, 40%, 25%)`,
                    }
              }
            >
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
              {rec.artist.logoUrl ? (
                <img
                  src={rec.artist.logoUrl}
                  alt={rec.artist.name}
                  className="absolute bottom-3 left-4 h-10 max-w-[60%] object-contain object-left drop-shadow-lg"
                />
              ) : (
                <span className="absolute bottom-3 left-4 text-white font-bold text-xl drop-shadow-lg">
                  {rec.artist.name}
                </span>
              )}
              <div className="absolute top-3 right-3 bg-black/60 backdrop-blur-sm rounded-lg px-2.5 py-1.5 flex items-baseline gap-0.5">
                <span className="text-accent text-lg font-bold leading-none">{pct}</span>
                <span className="text-white/50 text-micro-sm ml-1 uppercase tracking-wider">
                  {t('recommendation.match')}
                </span>
              </div>
            </div>

            {/* MusicBrainz link */}
            <div className="px-4 flex items-center gap-2">
              <a
                href={`https://musicbrainz.org/artist/${rec.artist.mbid}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-accent hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {t('recommendation.viewOnMusicBrainz')}
              </a>
            </div>

            {/* Recommendation reasoning */}
            {rec.aiReasoning && (
              <div className="mx-4 border-l-2 border-accent bg-surface/50 px-3 py-2 rounded-r">
                <p className="text-xs text-muted uppercase tracking-wide mb-1">
                  {t('recommendation.whyThisArtist')}
                </p>
                <p className="text-sm text-text italic">{rec.aiReasoning}</p>
              </div>
            )}

            {/* Top tracks */}
            <div className="px-4">
              <TopTracks artistId={rec.artist.id} />
            </div>

            {/* Per-source scores */}
            {rec.sources && Object.keys(rec.sources).length > 0 && (
              <div className="px-4">
                <p className="text-xs text-muted uppercase tracking-wide mb-2">
                  {t('recommendation.sourceScores')}
                </p>
                <div className="flex flex-wrap gap-3">
                  {Object.entries(rec.sources).map(([key, score]) => {
                    const classic = SOURCE_COLORS[key]
                    if (classic) {
                      return (
                        <div key={key} className="flex items-center gap-1.5">
                          <span
                            style={{ backgroundColor: classic.color }}
                            className="w-2 h-2 rounded-full inline-block"
                          />
                          <span className="text-xs text-muted">{classic.label}</span>
                          <span className="text-xs text-text font-medium">
                            {(score * 100).toFixed(0)}%
                          </span>
                        </div>
                      )
                    }
                    return (
                      <div key={key} className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            'text-micro px-1.5 py-0.5 rounded-full font-medium',
                            getSourceBadgeClass(key),
                          )}
                        >
                          {formatSourceLabel(key, t)}
                        </span>
                        <span className="text-xs text-text font-medium">
                          {(score * 100).toFixed(0)}%
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Full streaming links with optional Spotify embed */}
            <div className="px-4">
              <p className="text-xs text-muted uppercase tracking-wide mb-2">
                {t('recommendation.streaming')}
              </p>
              <StreamingLinks
                streamingUrls={rec.artist.streamingUrls}
                artistName={rec.artist.name}
                compact={false}
                onPlay={hasPreview && !bulkMode ? handlePlayFromLinks : undefined}
                isPlaying={artistIsPlaying}
              />
            </div>

            {/* Status for acted-on recs */}
            {isActed && (
              <StatusBadge
                status={rec.status}
                lidarrError={rec.lidarrError}
                targetActions={rec.targetActions}
                onRetry={onRetry}
                id={rec.id}
              />
            )}

            {/* Action buttons (re-shown in expanded too) -- hidden in bulk mode */}
            <div className="px-4">
              <ActionButtons
                rec={rec}
                bulkMode={bulkMode}
                isPending={isPending}
                isApproved={isApproved}
                onApprove={onApprove}
                onReject={onReject}
                approveNode={approveNode}
                targets={targets}
                onApproveToTarget={onApproveToTarget}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
