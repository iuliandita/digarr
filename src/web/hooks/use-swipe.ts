import { useCallback, useRef, useState } from 'react'

export type SwipeDirection = 'left' | 'right' | null

export type SwipeState = {
  offset: number
  direction: SwipeDirection
  swiping: boolean
}

export type UseSwipeOptions = {
  /** Fraction of card width required to commit the swipe. Default: 0.3 */
  threshold?: number
  onSwipeLeft?: () => void
  onSwipeRight?: () => void
}

// Hook

/**
 * Touch-based swipe detection.
 *
 * Uses a ref (offsetRef) for handler reads so handleTouchEnd never reads
 * stale closure state. The `state` value drives rendering only.
 */
export function useSwipe(options: UseSwipeOptions) {
  const { threshold = 0.3, onSwipeLeft, onSwipeRight } = options

  // Refs for handler reads (avoid stale closure)
  const offsetRef = useRef(0)
  const startXRef = useRef(0)
  const startYRef = useRef(0)
  const swipingRef = useRef(false)
  const cardRef = useRef<HTMLDivElement>(null)

  // State drives rendering
  const [state, setState] = useState<SwipeState>({
    offset: 0,
    direction: null,
    swiping: false,
  })

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0]
    if (!touch) return
    startXRef.current = touch.clientX
    startYRef.current = touch.clientY
    offsetRef.current = 0
    swipingRef.current = false
    setState({ offset: 0, direction: null, swiping: false })
  }, [])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0]
    if (!touch) return
    const dx = touch.clientX - startXRef.current
    const dy = touch.clientY - startYRef.current

    // Vertical dominates - let the page scroll, bail out
    if (!swipingRef.current && Math.abs(dy) > Math.abs(dx)) return

    // Commit to horizontal swipe once past 10px
    if (Math.abs(dx) > 10) swipingRef.current = true

    if (swipingRef.current) {
      offsetRef.current = dx
      const direction: SwipeDirection = dx > 0 ? 'right' : 'left'
      setState({ offset: dx, direction, swiping: true })
    }
  }, [])

  const handleTouchEnd = useCallback(() => {
    if (!swipingRef.current) return

    const cardWidth = cardRef.current?.offsetWidth ?? 300
    const commitDistance = cardWidth * threshold
    const current = offsetRef.current

    if (current > commitDistance && onSwipeRight) {
      navigator.vibrate?.(10)
      onSwipeRight()
    } else if (current < -commitDistance && onSwipeLeft) {
      navigator.vibrate?.(10)
      onSwipeLeft()
    }

    swipingRef.current = false
    offsetRef.current = 0
    setState({ offset: 0, direction: null, swiping: false })
  }, [threshold, onSwipeLeft, onSwipeRight])

  return {
    ref: cardRef,
    state,
    handlers: {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
    },
  }
}
