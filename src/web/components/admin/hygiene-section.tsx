import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/web/components/confirm-dialog'
import { getAiAuditResults, runHygieneTool } from '@/web/lib/api'

interface ToolDef {
  id: string
  name: string
  description: string
  params?: Record<string, string>
}

const TOOLS: ToolDef[] = [
  {
    id: 'clear-image-failures',
    name: 'Clear Image Failures',
    description: 'Reset failed image cache so the next scan retries.',
  },
  {
    id: 'rebuild-genres',
    name: 'Rebuild Genre Cache',
    description: 'Regenerate genres from artist tags and metadata.',
  },
  {
    id: 'rescore',
    name: 'Re-score Recommendations',
    description: 'Recalculate scores for pending recommendations with current weights.',
  },
  {
    id: 'dedupe',
    name: 'Dedupe Repair',
    description: 'Find and remove duplicate recommendations for the same artist.',
  },
  {
    id: 'ai-audit',
    name: 'AI Reasoning Audit',
    description: 'Detect artist/description mismatches from AI hallucinations.',
    params: { autoFix: 'true' },
  },
  {
    id: 'purge-sessions',
    name: 'Purge Expired Sessions',
    description: 'Delete expired login sessions.',
  },
]

export function HygieneSection() {
  const [running, setRunning] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, Record<string, unknown>>>({})
  const [confirmTool, setConfirmTool] = useState<ToolDef | null>(null)

  const { data: auditStatus } = useQuery({
    queryKey: ['aiAuditStatus'],
    queryFn: getAiAuditResults,
    refetchInterval: running === 'ai-audit' ? 3000 : false,
  })

  async function handleRun(tool: ToolDef) {
    setRunning(tool.id)
    setConfirmTool(null)
    try {
      const result = await runHygieneTool(tool.id, tool.params)
      setResults((prev) => ({ ...prev, [tool.id]: result }))
      toast.success(`${tool.name} completed`)
    } catch {
      toast.error(`${tool.name} failed`)
    } finally {
      setRunning(null)
    }
  }

  function formatResult(result: Record<string, unknown>): string {
    const entries = Object.entries(result).filter(([k]) => k !== 'tool')
    return entries
      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join(', ')
  }

  return (
    <div className="space-y-3 pt-2">
      {TOOLS.map((tool) => (
        <div
          key={tool.id}
          className="flex items-start justify-between gap-3 p-3 rounded-md border border-border"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium text-text">{tool.name}</p>
            <p className="text-xs text-muted">{tool.description}</p>
            {results[tool.id] != null && (
              <p className="text-xs text-accent mt-1">
                {formatResult(results[tool.id] as Record<string, unknown>)}
              </p>
            )}
            {tool.id === 'ai-audit' && auditStatus?.inProgress && (
              <p className="text-xs text-muted mt-1">
                Auto-fix in progress... ({auditStatus.fixedIds.length}/
                {auditStatus.flaggedIds.length} fixed)
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setConfirmTool(tool)}
            disabled={running === tool.id}
            className="shrink-0 px-2.5 py-1 text-xs font-medium rounded border border-border text-text hover:bg-surface disabled:opacity-50"
          >
            {running === tool.id ? 'Running...' : 'Run'}
          </button>
        </div>
      ))}

      {confirmTool && (
        <ConfirmDialog
          title={`Run ${confirmTool.name}?`}
          message={confirmTool.description}
          confirmLabel="Run"
          destructive={false}
          onConfirm={() => handleRun(confirmTool)}
          onCancel={() => setConfirmTool(null)}
        />
      )}
    </div>
  )
}
