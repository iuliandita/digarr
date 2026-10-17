import { useEffect, useRef, useState } from 'react'
import type { RejectionReason } from '@/core/recommendations/rejection-reasons'
import { shouldIgnoreShortcut } from '../hooks/use-keyboard-shortcuts'
import { useI18n } from '../lib/i18n'
import { prefersReducedMotion } from '../lib/utils'
import { ArtistThumb } from './artist-thumb'
import type { Recommendation } from './recommendation-card'
import { RejectionPicker } from './rejection-picker'
import { StreamingLinks } from './streaming-links'
import { SwipeCard } from './swipe-card'

export type RejectPayload = {
  reason?: RejectionReason | null
  reasonText?: string | null
  permanent?: boolean
}

type CardStackProps = {
  recommendations: Recommendation[]
  /** Server-side total; defaults to the loaded count. */
  totalCount?: number
  /** Changing this (e.g. a new filter) returns to the first card. */
  resetKey?: string
  /** Called as the user nears the last loaded card so the next page can load. */
  onNearEnd?: () => void
  onApprove: (id: number, prevStatus?: string) => void
  onReject: (id: number, prevStatus?: string, payload?: RejectPayload) => void
  onDetail: (id: number) => void
}

// Score ring (simple circle progress)

function ScoreRing({ score }: { score: number }) {
  const pct = Math.round(score * 100)
  const radius = 20
  const circumference = 2 * Math.PI * radius
  const dash = circumference * (pct / 100)

  return (
    <div className="relative w-14 h-14 shrink-0">
      <svg className="w-14 h-14 -rotate-90" viewBox="0 0 48 48" aria-hidden="true">
        <circle
          cx="24"
          cy="24"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          className="text-border"
        />
        <circle
          cx="24"
          cy="24"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeDasharray={`${dash} ${circumference - dash}`}
          strokeLinecap="round"
          className="text-accent"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-text">
        {pct}%
      </span>
    </div>
  )
}

// Single card in the stack

function StackCard({
  rec,
  onApprove,
  onReject,
  onDetail,
}: {
  rec: Recommendation
  onApprove: () => void
  onReject: () => void
  onDetail: () => void
}) {
  const { t } = useI18n()
  const isPending = rec.status === 'pending'
  const genres = rec.artist.genres ?? []
  const tags = rec.artist.tags ?? []
  const allTags = [...new Set([...genres, ...tags])].slice(0, 6)

  return (
    <div className="bg-surface border border-border rounded-2xl overflow-hidden shadow-lg flex flex-col h-full">
      {/* Artist image area */}
      <div className="relative h-48 sm:h-56 bg-bg overflow-hidden shrink-0">
        <ArtistThumb
          name={rec.artist.name}
          imageUrl={rec.artist.imageUrl}
          fill
          className="text-4xl"
        />
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-surface/90 via-surface/20 to-transparent" />
        {/* Score ring top-right */}
        <div className="absolute top-3 right-3">
          <ScoreRing score={rec.score} />
        </div>
      </div>

      {/* Card body */}
      <div className="flex flex-col flex-1 p-4 gap-3">
        {/* Artist name + disambiguation */}
        {rec.kind === 'album' ? (
          <div>
            <span
              data-testid="rec-kind-album"
              className="bg-accent/15 text-accent text-micro font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded"
            >
              {t('recommendation.albumBadge')}
            </span>
            <h2 className="text-xl font-bold text-text leading-tight mt-0.5">
              {rec.recommendedReleaseGroupTitle ?? rec.artist.name}
            </h2>
            <p className="text-xs text-muted mt-0.5">{rec.artist.name}</p>
          </div>
        ) : (
          <div>
            <h2 className="text-xl font-bold text-text leading-tight">{rec.artist.name}</h2>
            {rec.artist.disambiguation && (
              <p className="text-xs text-muted mt-0.5">{rec.artist.disambiguation}</p>
            )}
          </div>
        )}

        {/* Genre/tag pills */}
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {allTags.map((tag) => (
              <span
                key={tag}
                className="text-micro px-1.5 py-0.5 rounded-full bg-surface-2 text-text"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Recommendation reasoning */}
        {rec.aiReasoning && (
          <p className="text-xs text-muted italic leading-relaxed line-clamp-3">
            {rec.aiReasoning}
          </p>
        )}

        {/* Streaming links */}
        <StreamingLinks
          streamingUrls={rec.artist.streamingUrls}
          artistName={rec.artist.name}
          compact
        />

        <div className="flex-1" />

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          {isPending && (
            <>
              <button
                type="button"
                onClick={onReject}
                aria-label={t('recommendation.reject')}
                className="flex-1 py-2.5 rounded-xl bg-reject/10 text-reject border border-reject/30 font-medium text-sm hover:bg-reject/20 transition-colors"
              >
                {t('recommendation.reject')}
              </button>
              <button
                type="button"
                onClick={onDetail}
                aria-label={t('recommendation.viewDetails')}
                className="px-3 py-2.5 rounded-xl bg-surface border border-border text-muted hover:text-text transition-colors"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="w-4 h-4"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </button>
              <button
                type="button"
                onClick={onApprove}
                aria-label={t('recommendation.approve')}
                className="flex-1 py-2.5 rounded-xl bg-approve/10 text-approve border border-approve/30 font-medium text-sm hover:bg-approve/20 transition-colors"
              >
                {t('recommendation.approve')}
              </button>
            </>
          )}
          {!isPending && (
            <button
              type="button"
              onClick={onDetail}
              aria-label={t('recommendation.viewDetails')}
              className="flex-1 py-2.5 rounded-xl bg-surface border border-border text-muted hover:text-text transition-colors text-sm font-medium"
            >
              {t('recommendation.viewDetails')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// CardStack

/**
 * Dating-app style card stack: one card at a time, swipe left/right to act.
 * Arrow keys also navigate.
 */
const NEAR_END_CARDS = 5

export function CardStack({
  recommendations,
  totalCount,
  resetKey,
  onNearEnd,
  onApprove,
  onReject,
  onDetail,
}: CardStackProps) {
  const { t } = useI18n()
  const [index, setIndex] = useState(0)
  const [exiting, setExiting] = useState<'left' | 'right' | null>(null)
  const exitingRef = useRef(exiting)
  exitingRef.current = exiting
  const [pickerState, setPickerState] = useState<{
    id: number
    prevStatus?: string
    artistName?: string
  } | null>(null)

  const total = recommendations.length
  const rec = recommendations[index]
  const reducedMotion = prefersReducedMotion()

  // Keep stable refs for keyboard handler to avoid stale closures
  const approveRef = useRef<() => void>(() => {})
  const rejectRef = useRef<() => void>(() => {})

  const shownIdRef = useRef<number | undefined>(undefined)

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new resetKey alone returns to the first card
  useEffect(() => {
    setIndex(0)
    setExiting(null)
  }, [resetKey])

  // A refetch or an appended page keeps the card on screen instead of jumping back to the start.
  useEffect(() => {
    const shownId = shownIdRef.current
    if (shownId === undefined) return
    const at = recommendations.findIndex((r) => r.id === shownId)
    setIndex((i) => (at >= 0 ? at : Math.max(0, Math.min(i, recommendations.length - 1))))
  }, [recommendations])

  useEffect(() => {
    shownIdRef.current = rec?.id
  })

  useEffect(() => {
    if (total > 0 && index >= total - NEAR_END_CARDS) onNearEnd?.()
  }, [index, total, onNearEnd])

  // Keyboard: left arrow = reject, right arrow = approve, up/down = navigate
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (shouldIgnoreShortcut(e) || exitingRef.current) return

      if (e.key === 'ArrowRight') {
        e.preventDefault()
        approveRef.current()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        rejectRef.current()
      } else if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault()
        setIndex((i) => Math.min(i + 1, total - 1))
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault()
        setIndex((i) => Math.max(i - 1, 0))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [total])

  function triggerApprove() {
    if (!rec || exiting) return
    setExiting('right')
    setTimeout(() => {
      onApprove(rec.id, rec.status)
      setIndex((i) => Math.min(i + 1, total - 1))
      setExiting(null)
    }, 250)
  }
  approveRef.current = triggerApprove

  function triggerReject() {
    if (!rec || exiting || pickerState) return
    setPickerState({ id: rec.id, prevStatus: rec.status, artistName: rec.artist?.name })
  }
  rejectRef.current = triggerReject

  function commitReject(payload: RejectPayload) {
    const target = pickerState
    if (!target) return
    setExiting('left')
    setTimeout(() => {
      onReject(target.id, target.prevStatus, payload)
      setIndex((i) => Math.min(i + 1, total - 1))
      setExiting(null)
    }, 250)
  }

  if (total === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
        <div className="w-16 h-16 rounded-full bg-surface border border-border flex items-center justify-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-8 h-8 text-muted"
            aria-hidden="true"
          >
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
        </div>
        <div>
          <p className="text-text font-medium">{t('recommendation.noMore')}</p>
          <p className="text-xs text-muted mt-1">{t('recommendation.runScanToDiscover')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-sm mx-auto">
      {/* Counter */}
      <div className="flex items-center gap-2 text-xs text-muted">
        <button
          type="button"
          onClick={() => setIndex((i) => Math.max(i - 1, 0))}
          disabled={index === 0}
          aria-label={t('recommendation.previousCardNav')}
          className="flex min-h-11 min-w-11 items-center justify-center rounded hover:text-text disabled:opacity-30 transition-colors sm:min-h-8 sm:min-w-8"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-4 h-4"
            aria-hidden="true"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span className="tabular-nums font-medium">
          {t('cardStack.counter')
            .replace('{0}', String(index + 1))
            .replace('{1}', String(Math.max(totalCount ?? total, total)))}
        </span>
        <button
          type="button"
          onClick={() => setIndex((i) => Math.min(i + 1, total - 1))}
          disabled={index >= total - 1}
          aria-label={t('recommendation.nextCardNav')}
          className="flex min-h-11 min-w-11 items-center justify-center rounded hover:text-text disabled:opacity-30 transition-colors sm:min-h-8 sm:min-w-8"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-4 h-4"
            aria-hidden="true"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      {/* Card area with exit animation */}
      <div
        className="w-full transition-all duration-250"
        style={{
          // Reduced motion hides the card at once; the 250ms commit delay stays the same.
          transform:
            exiting && !reducedMotion
              ? `translateX(${exiting === 'right' ? '110%' : '-110%'}) rotate(${exiting === 'right' ? '8deg' : '-8deg'})`
              : 'translateX(0) rotate(0deg)',
          opacity: exiting ? 0 : 1,
          transition:
            exiting && !reducedMotion ? 'transform 0.25s ease-out, opacity 0.2s ease-out' : 'none',
        }}
      >
        {rec && (
          <SwipeCard
            enabled={rec.status === 'pending' && !exiting}
            onSwipeRight={rec.status === 'pending' ? triggerApprove : undefined}
            onSwipeLeft={rec.status === 'pending' ? triggerReject : undefined}
          >
            <StackCard
              rec={rec}
              onApprove={triggerApprove}
              onReject={triggerReject}
              onDetail={() => onDetail(rec.id)}
            />
          </SwipeCard>
        )}
      </div>

      {/* Swipe hint */}
      {rec?.status === 'pending' && (
        <p className="text-micro text-muted">{t('cardStack.swipeHint')}</p>
      )}

      <RejectionPicker
        open={pickerState != null}
        artistName={pickerState?.artistName}
        onClose={() => setPickerState(null)}
        onSubmit={async (payload) => {
          commitReject(payload)
        }}
      />
    </div>
  )
}
