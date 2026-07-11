import { useCallback, useEffect, useRef, useState } from 'react'
import type { usePreview } from './use-preview'

export type AuditionItem = {
  mbid: string
  artistName: string
  streamingUrls: Record<string, string> | null
}

export type AuditionQueue = {
  active: boolean
  index: number
  count: number
  current: AuditionItem | null
  start: (items: AuditionItem[]) => void
  next: () => void
  previous: () => void
  stop: () => void
}

// Embed sources (Spotify/YouTube iframes) expose no ended event; walk them on
// a fixed timer matching the 30s Deezer preview length.
export const EMBED_ADVANCE_MS = 30_000

type QueueState = { items: AuditionItem[]; index: number }

/**
 * Continuous playback of artist previews layered over the single-item
 * usePreview engine. Never instantiates its own audio element - every advance
 * goes through preview.play(), so the globalPlayId coordination with
 * card-local TopTracks audio keeps working with zero queue awareness.
 */
export function useAuditionQueue(preview: ReturnType<typeof usePreview>): AuditionQueue {
  const [queue, setQueue] = useState<QueueState | null>(null)
  const queueRef = useRef<QueueState | null>(null)
  const previewRef = useRef(preview)
  previewRef.current = preview
  // True while the queue's own play() transition is in flight, so the
  // deactivation watcher doesn't mistake it for an external playback change.
  const advancingRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastEndedRef = useRef(preview.playbackEndedCount)

  const setQueueState = useCallback((next: QueueState | null) => {
    queueRef.current = next
    setQueue(next)
  }, [])

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const deactivate = useCallback(() => {
    clearTimer()
    setQueueState(null)
  }, [clearTimer, setQueueState])

  const playIndex = useCallback(
    async function playIndexImpl(items: AuditionItem[], index: number): Promise<void> {
      clearTimer()
      const item = items[index]
      if (!item) return
      setQueueState({ items, index })
      advancingRef.current = true
      const outcome = await previewRef.current.play(
        item.mbid,
        item.artistName,
        item.streamingUrls,
        { suppressErrorToast: true },
      )
      advancingRef.current = false
      if (queueRef.current?.items !== items || queueRef.current.index !== index) return
      if (outcome === 'no-source' || outcome === 'blocked') {
        const { artistMbid } = previewRef.current.state
        if (artistMbid !== null && artistMbid !== item.mbid) {
          // Another surface started its own preview while ours resolved; it wins.
          deactivate()
          return
        }
        if (index + 1 < items.length) {
          void playIndexImpl(items, index + 1)
        } else {
          // Last item failed: nothing is playing, so no preview.stop() needed.
          deactivate()
        }
      }
    },
    [clearTimer, deactivate, setQueueState],
  )

  // Advance to the next item; past the last item this ends the queue.
  const advance = useCallback(() => {
    const q = queueRef.current
    if (!q) return
    if (q.index + 1 >= q.items.length) {
      deactivate()
      previewRef.current.stop()
      return
    }
    void playIndex(q.items, q.index + 1)
  }, [deactivate, playIndex])

  const start = useCallback(
    (items: AuditionItem[]) => {
      if (items.length === 0) return
      lastEndedRef.current = previewRef.current.playbackEndedCount
      // Stop first: if item 0 is already the playing artist, a bare play()
      // would toggle-pause it instead of starting the queue.
      previewRef.current.stop()
      void playIndex([...items], 0)
    },
    [playIndex],
  )

  const previous = useCallback(() => {
    const q = queueRef.current
    if (!q || q.index === 0) return
    void playIndex(q.items, q.index - 1)
  }, [playIndex])

  const stop = useCallback(() => {
    deactivate()
    previewRef.current.stop()
  }, [deactivate])

  // Advance when the Deezer audio element reports the current item finished.
  useEffect(() => {
    if (preview.playbackEndedCount === lastEndedRef.current) return
    lastEndedRef.current = preview.playbackEndedCount
    if (queueRef.current) advance()
  }, [preview.playbackEndedCount, advance])

  // Arm the fixed advance timer once an embed source is playing the queue's
  // current item; cleared on any playback change, deactivation, and unmount.
  useEffect(() => {
    if (!queue) return
    const { source, playing, artistMbid } = preview.state
    if (!playing || !source || source.type === 'deezer-audio') return
    if (artistMbid !== queue.items[queue.index]?.mbid) return
    timerRef.current = setTimeout(advance, EMBED_ADVANCE_MS)
    return clearTimer
  }, [queue, preview.state, advance, clearTimer])

  // User actions win: deactivate (without stopping what the user started)
  // when playback changes out from under the queue - a different artist
  // playing or an external stop.
  useEffect(() => {
    if (!queue) return
    if (advancingRef.current) return
    const current = queue.items[queue.index]
    if (!current) return
    if (preview.state.loading) return
    if (preview.state.artistMbid === current.mbid) return
    deactivate()
  }, [queue, preview.state, deactivate])

  useEffect(() => clearTimer, [clearTimer])

  return {
    active: queue !== null,
    index: queue?.index ?? 0,
    count: queue?.items.length ?? 0,
    current: queue ? (queue.items[queue.index] ?? null) : null,
    start,
    next: advance,
    previous,
    stop,
  }
}
