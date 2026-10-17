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
import { readStoredVolume } from '../lib/preview-volume'
import { cn, hueFromName } from '../lib/utils'
import { ArtistEnrichmentPanel } from './artist-enrichment-panel'
import { ArtistThumb } from './artist-thumb'
import { LibraryAlbumCoverageBadge } from './library-album-coverage-badge'
import { StreamingLinks } from './streaming-links'
import { Button } from './ui/button'

export type Recommendation = {
  id: number
  kind: 'artist' | 'album'
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

/** Accessible/display name: album recs carry the album title so two albums by one artist differ. */
export function recommendationDisplayName(
  rec: Pick<Recommendation, 'kind' | 'recommendedReleaseGroupTitle' | 'artist'>,
  t: (key: MessageKey) => string,
): string {
  if (rec.kind === 'album' && rec.recommendedReleaseGroupTitle) {
    return t('recommendation.albumByArtist')
      .replace('{album}', rec.recommendedReleaseGroupTitle)
      .replace('{artist}', rec.artist.name)
  }
  return rec.artist.name
}

type RecommendationCardProps = {
  recommendation: Recommendation
  onApprove: (id: number) => void
  onReject: (id: number) => void
  onClick?: (id: number) => void
  isSelected?: boolean
  expanded?: boolean
  onRetry?: (id: number) => void
  onRetryFailed?: (id: number, failedTargetIds: string[]) => void
  bulkMode?: boolean
  isChecked?: boolean
  onToggleSelect?: (id: number) => void
  warmStatus?: 'warm' | 'warming' | 'unknown'
  approveNode?: React.ReactNode
  targets?: Array<{ id: number; type: string; name: string }>
  onApproveToTarget?: (recId: number, targetId: string) => void
  /** Grid cards lead with the artist image; list rows keep a thumbnail. */
  layout?: 'grid' | 'list'
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
  return SUBSCRIPTION_COLORS[prefix] ?? 'bg-muted/20 text-muted'
}

const ANALYTICS_SOURCE_KEYS: Partial<Record<string, MessageKey>> = {
  similarity: 'analytics.source.similarity',
  aiConfidence: 'analytics.source.aiConfidence',
  feedbackBoost: 'analytics.source.feedbackBoost',
  consensus: 'analytics.source.consensus',
  genreOverlap: 'analytics.source.genreOverlap',
  popularity: 'analytics.source.popularity',
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
    default: {
      const analyticsKey = ANALYTICS_SOURCE_KEYS[sourceKey]
      return analyticsKey ? t(analyticsKey) : sourceKey
    }
  }
}

function StatusBadge({
  status,
  lidarrError,
  targetActions,
  onRetry,
  onRetryFailed,
  id,
}: {
  status: string
  lidarrError: string | null
  targetActions?: Record<string, { status?: string; error?: string } | null> | null
  onRetry?: (id: number) => void
  onRetryFailed?: (id: number, failedTargetIds: string[]) => void
  id: number
}) {
  const { t } = useI18n()
  const failedTargetIds = Object.entries(targetActions ?? {})
    .filter(([, action]) => action?.status === 'failed')
    .map(([targetId]) => targetId)
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
        {onRetryFailed && failedTargetIds.length > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onRetryFailed(id, failedTargetIds)
            }}
            className="text-xs text-accent underline"
          >
            {t('recommendation.retryFailed')}
          </button>
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
            onClick={(e) => {
              e.stopPropagation()
              onRetry(id)
            }}
            className="text-xs text-accent underline"
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
  const toggleRef = useRef<HTMLButtonElement>(null)
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
          ref={toggleRef}
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
          {actionableTargets.map((target) => (
            <button
              key={target.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                // Focus the toggle first so a dialog opened next restores focus here
                toggleRef.current?.focus()
                setOpen(false)
                onApproveToTarget?.(recId, `${target.type}-${target.id}`)
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
    const params = new URLSearchParams({ url: previewUrl })
    const proxyUrl = `/api/v1/preview/audio?${params.toString()}`
    const audio = new Audio(proxyUrl)
    audio.volume = readStoredVolume()
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
  onRetryFailed,
  bulkMode = false,
  isChecked = false,
  onToggleSelect,
  warmStatus,
  approveNode,
  targets,
  onApproveToTarget,
  layout = 'list',
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
  const hasFailure = rec.status === 'add_failed'

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

  const displayName = recommendationDisplayName(rec, t)
  const titleButton = (title: string) => (
    <button
      type="button"
      data-testid="rec-card-expand"
      aria-label={displayName}
      aria-expanded={bulkMode ? undefined : expanded}
      aria-pressed={bulkMode ? isChecked : undefined}
      onClick={(e) => {
        e.stopPropagation()
        handleCardClick()
      }}
      className="text-left rounded-sm focus-ring"
    >
      {title}
    </button>
  )

  return (
    <div className="relative group">
      {/* Bulk mode checkbox overlay */}
      {bulkMode && (
        <input
          type="checkbox"
          checked={isChecked}
          onClick={(e) => e.stopPropagation()}
          onChange={() => onToggleSelect?.(rec.id)}
          className="absolute top-2 left-2 z-20 w-4 h-4 accent-accent cursor-pointer"
          aria-label={`${t('recommendation.select')} ${displayName}`}
        />
      )}
      {/* Mouse convenience only: the title button is the keyboard/AT expand control, so the
          action buttons stay siblings instead of nesting inside an interactive wrapper. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: see above */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: see above */}
      <div
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
      >
        {layout === 'grid' && (
          <div
            className={cn(
              'relative w-full overflow-hidden rounded-t-surface',
              expanded ? 'h-48' : rec.artist.imageUrl ? 'aspect-[16/10]' : 'h-24',
            )}
          >
            <ArtistThumb
              name={rec.artist.name}
              imageUrl={rec.artist.imageUrl}
              fill
              className="rounded-none text-3xl"
            />
            <span className="absolute top-2 right-2 rounded-control bg-black/65 px-2 py-0.5 text-caption font-semibold text-white">
              {pct}
            </span>
            {rec.kind === 'album' && (
              <span
                data-testid="rec-kind-album"
                className={cn(
                  'absolute left-2 rounded-control bg-black/65 px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wide text-white',
                  hasFailure ? 'bottom-8' : 'bottom-2',
                )}
              >
                {t('recommendation.albumBadge')}
              </span>
            )}
            {hasFailure && (
              <span className="absolute inset-x-0 bottom-0 bg-reject/90 px-3 py-1 text-caption font-medium text-bg">
                {t('recommendation.addFailed')}
              </span>
            )}
          </div>
        )}
        <div className="p-4 space-y-3 flex-1">
          <div className="flex items-start gap-3">
            {layout === 'list' && (
              <ArtistThumb
                name={rec.artist.name}
                imageUrl={rec.artist.imageUrl}
                size={expanded ? 14 : 10}
              />
            )}
            <div className="flex-1 min-w-0 flex items-start justify-between gap-2">
              {rec.kind === 'album' ? (
                <div className="min-w-0">
                  {layout === 'list' && (
                    <span
                      data-testid="rec-kind-album"
                      className="bg-accent/15 text-accent text-micro font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded"
                    >
                      {t('recommendation.albumBadge')}
                    </span>
                  )}
                  <h3 className="text-lg font-semibold text-text leading-tight mt-0.5">
                    {titleButton(rec.recommendedReleaseGroupTitle ?? rec.artist.name)}
                  </h3>
                  <p className="text-xs text-muted mt-0.5">{rec.artist.name}</p>
                </div>
              ) : (
                <div className="min-w-0">
                  <h3 className="text-lg font-semibold text-text leading-tight">
                    {titleButton(rec.artist.name)}
                  </h3>
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
              )}
              {layout === 'list' && (
                <span className="shrink-0 bg-accent/20 text-accent text-xs font-semibold px-2 py-0.5 rounded">
                  {pct}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 overflow-hidden">
            <GenrePills genres={rec.artist.genres} max={expanded ? 8 : 2} compact={!expanded} />
          </div>

          {rec.artist.mbid && <LibraryAlbumCoverageBadge artistMbid={rec.artist.mbid} />}

          {isActed && !expanded && (
            <StatusBadge
              status={rec.status}
              lidarrError={rec.lidarrError}
              targetActions={rec.targetActions}
              onRetry={onRetry}
              onRetryFailed={onRetryFailed}
              id={rec.id}
            />
          )}

          {/* One decision row: preview, then the actions */}
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
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border text-muted transition-colors hover:text-text focus-ring"
                >
                  {artistIsPlaying ? (
                    <Pause size={14} aria-hidden="true" />
                  ) : (
                    <Play size={14} aria-hidden="true" />
                  )}
                </button>
              )}
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
          )}
        </div>

        {/* Expanded-only section */}
        {expanded && (
          <div className="border-t border-border pb-4 space-y-4">
            {/* Hero banner with artist image or gradient fallback; grid cards already lead with it */}
            {layout === 'list' && (
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
                  <span className="text-white/50 text-micro ml-1 uppercase tracking-wider">
                    {t('recommendation.match')}
                  </span>
                </div>
              </div>
            )}

            {/* MusicBrainz link and metadata cache state */}
            <div className="px-4 flex items-center gap-2">
              {warmStatus === 'warm' && (
                <span
                  className="w-2 h-2 rounded-full bg-approve"
                  title={t('recommendation.metadataCached')}
                  role="img"
                  aria-label={t('recommendation.metadataCached')}
                />
              )}
              {warmStatus === 'warming' && (
                <span
                  className="w-2 h-2 rounded-full bg-warning animate-pulse"
                  title={t('recommendation.warmingCache')}
                  role="img"
                  aria-label={t('recommendation.warmingCache')}
                />
              )}
              <a
                href={`https://musicbrainz.org/artist/${rec.artist.mbid}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-accent underline"
                onClick={(e) => e.stopPropagation()}
              >
                {t('recommendation.viewOnMusicBrainz')}
              </a>
            </div>

            {/* Recommendation reasoning */}
            {rec.aiReasoning && (
              <div className="mx-4 rounded-md border border-accent/30 bg-accent/8 px-3 py-2">
                <p className="text-xs text-muted uppercase tracking-wide mb-1">
                  {t('recommendation.whyThisArtist')}
                </p>
                <p className="text-sm text-text italic">{rec.aiReasoning}</p>
              </div>
            )}

            {/* Wikidata enrichment: bio + external links */}
            <div className="px-4">
              <ArtistEnrichmentPanel artistId={rec.artist.id} mbid={rec.artist.mbid} />
            </div>

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
                onRetryFailed={onRetryFailed}
                id={rec.id}
              />
            )}

            {/* Action buttons (re-shown in expanded too) - hidden in bulk mode */}
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
