import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import type { MessageKey } from '@/core/i18n/messages/types'
import { ConfirmDialog } from '@/web/components/confirm-dialog'
import { getAiAuditResults, runHygieneTool } from '@/web/lib/api'
import { useI18n } from '@/web/lib/i18n'

interface ToolDef {
  id: string
  nameKey: MessageKey
  descKey: MessageKey
  params?: Record<string, string>
}

const TOOLS: ToolDef[] = [
  {
    id: 'clear-image-failures',
    nameKey: 'admin.clearImageFailures',
    descKey: 'admin.clearImageFailuresDesc',
  },
  {
    id: 'rebuild-genres',
    nameKey: 'admin.rebuildGenreCache',
    descKey: 'admin.rebuildGenreCacheDesc',
  },
  {
    id: 'rescore',
    nameKey: 'admin.rescoreRecommendations',
    descKey: 'admin.rescoreRecommendationsDesc',
  },
  {
    id: 'dedupe',
    nameKey: 'admin.dedupeRepair',
    descKey: 'admin.dedupeRepairDesc',
  },
  {
    id: 'ai-audit',
    nameKey: 'admin.aiReasoningAudit',
    descKey: 'admin.aiReasoningAuditDesc',
    params: { autoFix: 'true' },
  },
  {
    id: 'purge-sessions',
    nameKey: 'admin.purgeExpiredSessions',
    descKey: 'admin.purgeExpiredSessionsDesc',
  },
]

export function HygieneSection() {
  const { t } = useI18n()
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
      toast.success(`${t(tool.nameKey)} completed`)
    } catch {
      toast.error(`${t(tool.nameKey)} failed`)
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
            <p className="text-sm font-medium text-text">{t(tool.nameKey)}</p>
            <p className="text-xs text-muted">{t(tool.descKey)}</p>
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
            {running === tool.id ? t('admin.running') : t('admin.run')}
          </button>
        </div>
      ))}

      {confirmTool && (
        <ConfirmDialog
          title={`${t('admin.run')} ${t(confirmTool.nameKey)}?`}
          message={t(confirmTool.descKey)}
          confirmLabel={t('admin.run')}
          destructive={false}
          onConfirm={() => handleRun(confirmTool)}
          onCancel={() => setConfirmTool(null)}
        />
      )}
    </div>
  )
}
