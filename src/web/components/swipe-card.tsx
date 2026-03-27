import type { ReactNode } from 'react'
import { useSwipe } from '../hooks/use-swipe'
import { cn } from '../lib/utils'

type SwipeCardProps = {
  onSwipeLeft?: () => void
  onSwipeRight?: () => void
  /** Only enable swipe interactions when true (default true) */
  enabled?: boolean
  children: ReactNode
}

// Icons (inline SVG to avoid adding a dep)

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('w-8 h-8', className)}
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('w-8 h-8', className)}
      aria-hidden="true"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

// SwipeCard

/**
 * Wraps children with touch-based swipe gestures.
 * - Right swipe -> onSwipeRight (approve)
 * - Left swipe  -> onSwipeLeft  (reject)
 * - Tint overlay and icon fade in proportional to swipe offset
 * - Spring-back animation when swipe doesn't meet the threshold
 */
export function SwipeCard({ onSwipeLeft, onSwipeRight, enabled = true, children }: SwipeCardProps) {
  const { ref, state, handlers } = useSwipe({
    onSwipeLeft: enabled ? onSwipeLeft : undefined,
    onSwipeRight: enabled ? onSwipeRight : undefined,
  })

  const { offset, direction, swiping } = state

  // How far along (0-1) relative to a nominal 120px full-commit distance
  const intensity = Math.min(Math.abs(offset) / 120, 1)
  const tintOpacity = intensity * 0.25
  const iconOpacity = intensity

  const isRight = direction === 'right'
  const isLeft = direction === 'left'

  return (
    <div ref={ref} className={cn('relative rounded-lg', swiping && 'overflow-hidden')}>
      {/* Tint overlay -- stays in place, card slides over it */}
      {enabled && swiping && (
        <div
          className={cn(
            'absolute inset-0 rounded-lg pointer-events-none flex items-center',
            isRight ? 'justify-start pl-4' : 'justify-end pr-4',
          )}
          style={{
            backgroundColor: isRight
              ? `rgba(var(--color-approve-rgb, 74 222 128) / ${tintOpacity})`
              : isLeft
                ? `rgba(var(--color-reject-rgb, 248 113 113) / ${tintOpacity})`
                : 'transparent',
          }}
        >
          {isRight && (
            <span style={{ opacity: iconOpacity }}>
              <CheckIcon className="text-approve" />
            </span>
          )}
          {isLeft && (
            <span style={{ opacity: iconOpacity }}>
              <XIcon className="text-reject" />
            </span>
          )}
        </div>
      )}

      {/* Sliding card content */}
      <div
        style={
          {
            transform: enabled && offset !== 0 ? `translateX(${offset}px)` : undefined,
            transition:
              enabled && !swiping ? 'transform 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94)' : 'none',
          } as React.CSSProperties
        }
        {...(enabled ? handlers : {})}
      >
        {children}
      </div>
    </div>
  )
}
