import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
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
  // Tracks which button fired the current sync so only its spinner animates.
  // `undefined` means no in-flight sync; `null` means "Sync all"; a string means a source id.
  const [pendingTarget, setPendingTarget] = useState<string | null | undefined>(undefined)

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
    onSettled: () => {
      setPendingTarget(undefined)
    },
  })

  const isSyncing = syncMutation.isPending
  const allPending = isSyncing && pendingTarget === null
  const sourcePending = (sourceId: string) => isSyncing && pendingTarget === sourceId

  const sources = sourcesQuery.data?.sources ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-semibold text-text uppercase tracking-wide">Library Sources</h2>
        <button
          type="button"
          onClick={() => {
            setPendingTarget(null)
            syncMutation.mutate(undefined)
          }}
          disabled={isSyncing}
          className="flex items-center gap-2 px-3 py-1.5 bg-accent text-accent-fg rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          <RefreshCw size={14} className={allPending ? 'animate-spin' : undefined} />
          Sync all
        </button>
      </div>

      {sources.length === 0 ? (
        <div className="bg-surface border border-border rounded-lg px-4 py-8 text-center text-muted text-sm">
          No library sources configured. Add Lidarr, Plex, Jellyfin, or Emby in Settings.
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
                    onClick={() => {
                      setPendingTarget(row.source)
                      syncMutation.mutate(row.source)
                    }}
                    disabled={isSyncing}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-text border border-border rounded hover:opacity-90 disabled:opacity-50 transition-opacity shrink-0"
                  >
                    <RefreshCw
                      size={12}
                      className={sourcePending(row.source) ? 'animate-spin' : undefined}
                    />
                    Sync now
                  </button>
                </div>

                {counts != null && (
                  <div className="space-y-2">
                    <div className="text-xs text-muted">
                      {counts.total} artists
                      {typeof counts.albumsSynced === 'number'
                        ? ` -- ${counts.albumsSynced} albums`
                        : ''}
                      {' -- '}
                      {counts.matchedMbid} MBID, {counts.matchedNameExact} exact,{' '}
                      {counts.matchedNameAnchored} anchored, {counts.matchedDisambiguated}{' '}
                      disambiguated, {unreconciled} unreconciled
                    </div>

                    {typeof counts.albumsSynced === 'number' && (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-wide text-muted">
                          <span>Albums synced</span>
                          <span className="font-medium text-text">{counts.albumsSynced}</span>
                        </div>
                        <div
                          data-testid={`albums-bar-${row.source}`}
                          className="h-1.5 overflow-hidden rounded-full bg-border/70"
                        >
                          <div className="h-full w-full rounded-full bg-accent" />
                        </div>
                      </div>
                    )}
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
