import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { getLibrarySources, triggerLibrarySync } from '../lib/api'

function timeAgo(iso: string | null): string {
  if (!iso) return 'never'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return 'just now'
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)} min ago`
  return `${Math.floor(ms / 3600_000)} h ago`
}

function statusColor(status: string | null): string {
  if (status === 'completed') return 'text-green-500'
  if (status === 'failed') return 'text-red-500'
  if (status === 'running') return 'text-amber-500'
  return 'text-muted'
}

export function LibrarySourcesPanel() {
  const queryClient = useQueryClient()

  const sourcesQuery = useQuery({
    queryKey: ['library', 'sources'],
    queryFn: getLibrarySources,
    refetchInterval: (query) =>
      query.state.data?.sources?.some((s) => s.lastSyncStatus === 'running') ? 5000 : false,
  })

  const syncMutation = useMutation({
    mutationFn: triggerLibrarySync,
    onSuccess: () => {
      toast.success('Sync started')
      queryClient.invalidateQueries({ queryKey: ['library', 'sources'] })
    },
    onError: (err: Error) => {
      toast.error(`Sync failed: ${err.message}`)
    },
  })

  const sources = sourcesQuery.data?.sources ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-semibold text-text uppercase tracking-wide">Library Sources</h2>
        <button
          type="button"
          onClick={() => syncMutation.mutate(undefined)}
          disabled={syncMutation.isPending}
          className="flex items-center gap-2 px-3 py-1.5 bg-accent text-accent-fg rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          <RefreshCw size={14} className={syncMutation.isPending ? 'animate-spin' : undefined} />
          Sync all
        </button>
      </div>

      {sources.length === 0 ? (
        <div className="bg-surface border border-border rounded-lg px-4 py-8 text-center text-muted text-sm">
          No library sources configured. Add Lidarr, Plex, or Jellyfin in Settings.
        </div>
      ) : (
        <div className="space-y-3">
          {sources.map((row) => {
            const counts = row.lastSyncCounts
            const unreconciled =
              counts != null
                ? (counts.unreconciledAmbiguous ?? 0) + (counts.unreconciledNoCandidate ?? 0)
                : null

            return (
              <div
                key={`${row.source}-${row.userId ?? 'global'}`}
                className="bg-surface border border-border rounded-lg p-4 space-y-2"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-text">{row.source}</span>
                      <span className={`text-xs ${statusColor(row.lastSyncStatus)}`}>
                        {row.lastSyncStatus ?? 'never synced'}
                      </span>
                    </div>
                    <div className="text-xs text-muted">
                      Last synced: {timeAgo(row.lastSyncCompletedAt)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => syncMutation.mutate(row.source)}
                    disabled={syncMutation.isPending}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-text border border-border rounded hover:opacity-90 disabled:opacity-50 transition-opacity shrink-0"
                  >
                    <RefreshCw size={12} />
                    Sync now
                  </button>
                </div>

                {counts != null && (
                  <div className="text-xs text-muted">
                    {counts.total} artists -- {counts.matchedMbid} MBID, {counts.matchedNameExact}{' '}
                    exact, {counts.matchedNameAnchored} anchored, {counts.matchedDisambiguated}{' '}
                    disambiguated, {unreconciled} unreconciled
                  </div>
                )}

                {row.lastSyncError && (
                  <div className="text-xs text-red-500">{row.lastSyncError}</div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
