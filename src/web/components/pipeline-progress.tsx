import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { getPipelineStatus } from '../lib/api'
import { useSSE } from '../lib/hooks'

type SSEProgress = {
  stage: string
  current?: number
  total?: number
  message?: string
}

const STAGES = ['collect', 'analyze', 'discover', 'resolve', 'score', 'filter', 'store', 'complete']

const STAGE_LABELS: Record<string, string> = {
  collect: 'Reading library',
  analyze: 'Building taste profile',
  discover: 'Finding new artists',
  resolve: 'Looking up metadata',
  score: 'Ranking matches',
  filter: 'Removing duplicates',
  store: 'Saving results',
  complete: 'Done',
}

function stageIndex(stage: string): number {
  const idx = STAGES.indexOf(stage)
  return idx === -1 ? 0 : idx
}

export function PipelineProgress({ onComplete }: { onComplete?: () => void }) {
  const { data: status } = useQuery({
    queryKey: ['pipelineStatus'],
    queryFn: getPipelineStatus,
  })
  const { data: sseData } = useSSE('/api/pipeline/events')
  const completeFired = useRef(false)

  const progress = sseData as SSEProgress | null
  const isRunning = status?.running ?? false

  const stage = progress?.stage ?? (status?.running ? (status.stage ?? 'collect') : null)
  const stageIdx = stage ? stageIndex(stage) : 0
  const pct = stage ? Math.round(((stageIdx + 1) / STAGES.length) * 100) : 0
  const label = stage ? (STAGE_LABELS[stage] ?? stage) : ''

  const current = progress?.current
  const total = progress?.total

  // Fire onComplete exactly once when pipeline finishes
  useEffect(() => {
    if (stage === 'complete' && onComplete && !completeFired.current) {
      completeFired.current = true
      setTimeout(onComplete, 500)
    }
    if (stage && stage !== 'complete') {
      completeFired.current = false
    }
  }, [stage, onComplete])

  if (!isRunning && !progress) return null

  return (
    <div className="bg-surface border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {stage !== 'complete' && (
            <span className="inline-block h-2 w-2 rounded-full bg-accent animate-pulse" />
          )}
          <span className="text-sm font-medium text-text">{label}</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted">
          {current !== undefined && total !== undefined && (
            <span>
              {current}/{total}
            </span>
          )}
          <span>{pct}%</span>
        </div>
      </div>

      {/* Stage dots */}
      <div className="flex gap-1">
        {STAGES.slice(0, -1).map((s, i) => (
          <div
            key={s}
            className={[
              'h-1 flex-1 rounded-full transition-all duration-300',
              i < stageIdx ? 'bg-accent' : i === stageIdx ? 'bg-accent/60' : 'bg-bg',
            ].join(' ')}
          />
        ))}
      </div>

      {(progress?.message ?? status?.message) && (
        <p className="text-xs text-muted">{progress?.message ?? status?.message}</p>
      )}
    </div>
  )
}
