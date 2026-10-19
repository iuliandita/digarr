import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import type { MessageKey } from '@/core/i18n/messages/types'
import { cancelPipeline, getPipelineStatus } from '../lib/api'
import { useSSE } from '../lib/hooks'
import { useI18n } from '../lib/i18n'

type SSEProgress = {
  stage: string
  current?: number
  total?: number
  message?: string
}

const STAGES = ['collect', 'analyze', 'discover', 'resolve', 'score', 'filter', 'store', 'complete']

const STAGE_LABELS: Record<string, MessageKey> = {
  collect: 'pipeline.stage.collect',
  analyze: 'pipeline.stage.analyze',
  discover: 'pipeline.stage.discover',
  resolve: 'pipeline.stage.resolve',
  score: 'pipeline.stage.score',
  filter: 'pipeline.stage.filter',
  store: 'pipeline.stage.store',
  complete: 'pipeline.stage.complete',
}

const STAGE_DESCRIPTIONS: Record<string, MessageKey> = {
  collect: 'pipeline.description.collect',
  analyze: 'pipeline.description.analyze',
  discover: 'pipeline.description.discover',
  resolve: 'pipeline.description.resolve',
  score: 'pipeline.description.score',
  filter: 'pipeline.description.filter',
  store: 'pipeline.description.store',
  complete: 'pipeline.description.complete',
}

const FIRST_SCAN_DESCRIPTIONS: Record<string, MessageKey> = {
  ...STAGE_DESCRIPTIONS,
  complete: 'pipeline.firstScanComplete',
}

function stageIndex(stage: string): number {
  const idx = STAGES.indexOf(stage)
  return idx === -1 ? 0 : idx
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m === 0) return `${s}s`
  return `${m}m ${s.toString().padStart(2, '0')}s`
}

const STALL_THRESHOLD_MS = 30_000
const STATUS_POLL_MS = 10_000
const TERMINAL_STAGES = ['complete', 'cancelled']
// Two polls in a row, so a status that flips a beat before the 'complete' event lands is ignored.
const NOT_RUNNING_POLLS_TO_END = 2

export function PipelineProgress({
  onComplete,
  isFirstScan = false,
}: {
  onComplete?: () => void
  isFirstScan?: boolean
}) {
  const { t } = useI18n()
  const { data: sseData } = useSSE('/api/v1/pipeline/events')
  const progress = sseData as SSEProgress | null
  // A killed server never sends a terminal event, so keep checking the status while a stage shows.
  const showingLiveStage = progress != null && !TERMINAL_STAGES.includes(progress.stage)
  const { data: status, dataUpdatedAt } = useQuery({
    queryKey: ['pipelineStatus'],
    queryFn: getPipelineStatus,
    refetchInterval: showingLiveStage ? STATUS_POLL_MS : false,
  })
  const completeFired = useRef(false)

  // Elapsed timer
  const [elapsed, setElapsed] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startedRef = useRef(false)

  // Stall detection
  const lastEventRef = useRef<number>(Date.now())
  const [stalled, setStalled] = useState(false)

  const [cancelling, setCancelling] = useState(false)

  const [interruptedEvent, setInterruptedEvent] = useState<SSEProgress | null>(null)
  const notRunningPolls = useRef(0)
  const lastPollRef = useRef(0)

  const isRunning = status?.running ?? false

  const stage = progress?.stage ?? (status?.running ? (status.stage ?? 'collect') : null)
  const cancelled = stage === 'cancelled'
  const interrupted = progress != null && interruptedEvent === progress
  const isTerminal = stage === 'complete' || cancelled || interrupted
  const stageIdx = stage ? stageIndex(stage) : 0
  const pct = stage ? Math.round(((stageIdx + 1) / STAGES.length) * 100) : 0
  const label = stage ? (STAGE_LABELS[stage] ? t(STAGE_LABELS[stage]) : stage) : ''
  const descriptions = isFirstScan ? FIRST_SCAN_DESCRIPTIONS : STAGE_DESCRIPTIONS
  const description = stage ? (descriptions[stage] ? t(descriptions[stage]) : '') : ''

  const current = progress?.current
  const total = progress?.total

  // The last SSE event is non-terminal but the server has stopped running: it died mid-scan.
  useEffect(() => {
    if (dataUpdatedAt === lastPollRef.current) return
    lastPollRef.current = dataUpdatedAt
    const idle =
      status != null && !status.running && !(status.queuePosition && status.queuePosition > 0)
    if (!progress || TERMINAL_STAGES.includes(progress.stage) || !idle) {
      notRunningPolls.current = 0
      if (status?.running) setInterruptedEvent(null)
      return
    }
    notRunningPolls.current += 1
    if (notRunningPolls.current >= NOT_RUNNING_POLLS_TO_END) setInterruptedEvent(progress)
  }, [dataUpdatedAt, status, progress])

  // Start timer on first SSE event
  useEffect(() => {
    if (progress && !startedRef.current) {
      startedRef.current = true
      setElapsed(0)
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000)
    }
    if (progress) {
      lastEventRef.current = Date.now()
      setStalled(false)
    }
  }, [progress])

  // Stall detection check
  useEffect(() => {
    if (!stage || isTerminal) return
    const interval = setInterval(() => {
      if (Date.now() - lastEventRef.current > STALL_THRESHOLD_MS) {
        setStalled(true)
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [stage, isTerminal])

  // Clean up timer on terminal (complete/cancelled/interrupted) or unmount
  useEffect(() => {
    if (isTerminal && timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (interrupted) {
      // let the next run's first event restart the timer
      startedRef.current = false
      setElapsed(0)
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [isTerminal, interrupted])

  // Reset timer state when pipeline stops
  useEffect(() => {
    if (!isRunning && !progress) {
      startedRef.current = false
      setElapsed(0)
      setStalled(false)
    }
  }, [isRunning, progress])

  // Fire onComplete exactly once when the pipeline finishes or is stopped
  useEffect(() => {
    if (isTerminal && !interrupted && onComplete && !completeFired.current) {
      completeFired.current = true
      setCancelling(false)
      setTimeout(onComplete, 500)
    }
    if (stage && !isTerminal) {
      completeFired.current = false
    }
  }, [stage, isTerminal, interrupted, onComplete])

  async function handleStop() {
    setCancelling(true)
    try {
      const result = await cancelPipeline()
      if (!result.cancelled) setCancelling(false)
    } catch {
      // Best-effort: the SSE 'cancelled' event drives the UI; on failure the
      // user can retry. Reset the button so it isn't stuck disabled.
      setCancelling(false)
    }
  }

  if (!isRunning && !progress) return null

  if (interrupted) {
    return (
      <div className="bg-surface border border-border rounded-lg p-4">
        <p role="status" className="text-sm text-text">
          {t('pipeline.interrupted')}
        </p>
      </div>
    )
  }

  return (
    <div className="bg-surface border border-border rounded-lg p-4 space-y-3">
      {/* Header */}
      {isFirstScan && !isTerminal && (
        <div className="space-y-1">
          <p className="text-sm font-medium text-text">{t('pipeline.runningFirstScan')}</p>
          <p className="text-xs text-muted">{t('pipeline.firstScanDescription')}</p>
        </div>
      )}

      {/* Stage label + counters */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {!isTerminal && (
            <span className="inline-block h-2 w-2 rounded-full bg-accent animate-pulse" />
          )}
          <span className="text-sm font-medium text-text">
            {cancelled ? t('pipeline.cancelled') : label}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted">
          {startedRef.current && !isTerminal && (
            <span>
              {t('pipeline.runningFor')} {formatElapsed(elapsed)}
            </span>
          )}
          {!cancelled && current !== undefined && total !== undefined && (
            <span>
              {current}/{total}
            </span>
          )}
          {!cancelled && <span>{pct}%</span>}
          {!isTerminal && (
            <button
              type="button"
              onClick={handleStop}
              disabled={cancelling}
              className="rounded border border-border px-2 py-0.5 text-xs font-medium text-text hover:bg-bg disabled:opacity-50"
            >
              {cancelling ? t('pipeline.stopping') : t('pipeline.stop')}
            </button>
          )}
        </div>
      </div>

      {/* Segmented progress bar */}
      {!cancelled && (
        <div className="flex gap-1">
          {STAGES.slice(0, -1).map((s, i) => (
            <div
              key={s}
              className={[
                'h-1.5 flex-1 rounded-full transition-all duration-300',
                i < stageIdx
                  ? 'bg-accent'
                  : i === stageIdx
                    ? 'bg-accent/60 animate-pulse'
                    : 'bg-bg',
              ].join(' ')}
            />
          ))}
        </div>
      )}

      {/* Stage description */}
      {!cancelled && description && <p className="text-xs text-muted">{description}</p>}

      {/* Stall warning */}
      {stalled && !isTerminal && (
        <p className="text-xs text-muted italic">{t('pipeline.stalled')}</p>
      )}

      {/* SSE message */}
      {!stalled && (progress?.message ?? status?.message) && (
        <p className="text-xs text-muted">{progress?.message ?? status?.message}</p>
      )}
    </div>
  )
}
