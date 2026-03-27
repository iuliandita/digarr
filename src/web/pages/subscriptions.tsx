import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronDown,
  ChevronRight,
  LayoutGrid,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Hint } from '../components/hint'
import { SubscriptionForm, type SubscriptionFormData } from '../components/subscription-form'
import { SubscriptionPresets } from '../components/subscription-presets'
import { Skeleton } from '../components/ui/skeleton'
import {
  bulkToggleSubscriptions,
  createSubscriptionApi,
  deleteSubscriptionApi,
  getOAuthStatus,
  getSchedulerInfo,
  getSettings,
  getSubscriptionRuns,
  getSubscriptions,
  type Subscription,
  type SubscriptionRun,
  triggerSubscriptionRun,
  updateSubscriptionApi,
} from '../lib/api'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'Never'
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatRelative(dateStr: string | null): string {
  if (!dateStr) return 'N/A'
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = date.getTime() - now.getTime()
  if (diffMs < 0) return 'overdue'
  const hours = Math.floor(diffMs / (1000 * 60 * 60))
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))
  if (hours > 24) return `${Math.floor(hours / 24)}d`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function formatDuration(startedAt: string, completedAt: string | null): string {
  if (!completedAt) return '--'
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime()
  const secs = Math.round(ms / 1000)
  if (secs < 60) return `${secs}s`
  return `${Math.floor(secs / 60)}m ${secs % 60}s`
}

function runStatus(run: SubscriptionRun): { label: string; className: string } {
  if (run.error) return { label: 'Failed', className: 'text-reject' }
  if (!run.completedAt) return { label: 'Running', className: 'text-accent' }
  return { label: 'Done', className: 'text-approve' }
}

// ---------------------------------------------------------------------------
// RunHistoryPanel
// ---------------------------------------------------------------------------

function RunHistoryPanel({ subscriptionId }: { subscriptionId: number }) {
  const { data: runs, isLoading } = useQuery({
    queryKey: ['subscription-runs', subscriptionId],
    queryFn: () => getSubscriptionRuns(subscriptionId),
  })

  if (isLoading) {
    return (
      <div className="px-4 pb-4 space-y-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    )
  }

  if (!runs || runs.length === 0) {
    return (
      <div className="px-4 pb-4">
        <p className="text-sm text-muted">No runs yet.</p>
      </div>
    )
  }

  return (
    <div className="px-4 pb-4 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-muted text-xs uppercase tracking-wide">
            <th className="text-left px-2 py-1.5 font-medium">Started</th>
            <th className="text-left px-2 py-1.5 font-medium">Duration</th>
            <th className="text-right px-2 py-1.5 font-medium">Found</th>
            <th className="text-right px-2 py-1.5 font-medium">New</th>
            <th className="text-left px-2 py-1.5 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {runs.map((run) => {
            const status = runStatus(run)
            return (
              <tr key={run.id} className="hover:bg-bg/50 transition-colors">
                <td className="px-2 py-1.5 text-text">{formatDate(run.startedAt)}</td>
                <td className="px-2 py-1.5 text-muted">
                  {formatDuration(run.startedAt, run.completedAt)}
                </td>
                <td className="px-2 py-1.5 text-right text-text">{run.artistsFound}</td>
                <td className="px-2 py-1.5 text-right text-text">{run.artistsNew}</td>
                <td className="px-2 py-1.5">
                  <span className={`text-xs font-medium ${status.className}`}>{status.label}</span>
                  {run.error && (
                    <span
                      className="block text-xs text-reject/70 truncate max-w-[200px]"
                      title={run.error}
                    >
                      {run.error}
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SubscriptionCard
// ---------------------------------------------------------------------------

function SubscriptionCard({
  sub,
  nextRun,
  onEdit,
  onDelete,
  onToggle,
  onRunNow,
}: {
  sub: Subscription
  nextRun: string | null
  onEdit: () => void
  onDelete: () => void
  onToggle: () => void
  onRunNow: () => void
}) {
  const [expanded, setExpanded] = useState(false)

  const sourceLabel = (() => {
    const cfg = sub.sourceConfig as Record<string, unknown>
    if (sub.sourceType === 'genre') return (cfg.genre as string) ?? null
    if (sub.sourceType === 'similar') {
      const seeds = cfg.seedArtists as Array<{ name: string }> | undefined
      return seeds?.map((s) => s.name).join(', ') ?? null
    }
    if (sub.sourceType === 'lastfm-tag') return (cfg.tag as string) ?? null
    if (sub.sourceType === 'listenbrainz') return (cfg.feedType as string) ?? null
    if (sub.sourceType === 'spotify-playlist') return (cfg.playlistName as string) ?? null
    return null
  })()

  const actionLabel = 'Add to recommendations'

  return (
    <div className="bg-surface border border-border rounded-lg">
      {/* Header */}
      <div className="p-4 flex items-start gap-3">
        {/* Expand chevron */}
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-0.5 text-muted hover:text-text transition-colors shrink-0"
          aria-label={expanded ? 'Collapse run history' : 'Expand run history'}
        >
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>

        {/* Info */}
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-text truncate">{sub.name}</span>
            {sourceLabel && (
              <span className="text-xs px-2 py-0.5 bg-accent/15 text-accent rounded-full shrink-0">
                {sourceLabel}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted flex-wrap">
            <span>
              {Array.isArray((sub.sourceConfig as Record<string, unknown>)?.providers)
                ? ((sub.sourceConfig as Record<string, unknown>).providers as string[]).join(', ')
                : sub.sourceProvider}
            </span>
            <span>{actionLabel}</span>
            <span className="font-mono">{sub.cron}</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted flex-wrap">
            {nextRun && (
              <span>
                Next: <span className="text-text">{formatRelative(nextRun)}</span>
              </span>
            )}
            <span>
              Last: <span className="text-text">{formatDate(sub.lastRunAt)}</span>
              {sub.lastResultCount != null && (
                <span className={`ml-1 ${sub.lastResultCount > 0 ? 'text-approve' : 'text-muted'}`}>
                  ({sub.lastResultCount} found)
                </span>
              )}
            </span>
            {sub.lastError && (
              <span className="text-reject" title={sub.lastError}>
                Error
              </span>
            )}
          </div>
        </div>

        {/* Enable/disable toggle */}
        <button
          type="button"
          onClick={onToggle}
          className={`shrink-0 w-10 h-5 rounded-full transition-colors relative ${
            sub.enabled ? 'bg-approve' : 'bg-border'
          }`}
          aria-label={sub.enabled ? 'Disable subscription' : 'Enable subscription'}
        >
          <span
            className={`absolute top-0.5 w-4 h-4 rounded-full bg-bg transition-transform ${
              sub.enabled ? 'left-5' : 'left-0.5'
            }`}
          />
        </button>

        {/* Action buttons */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onRunNow}
            className="p-1.5 text-muted hover:text-accent transition-colors"
            title="Run now"
          >
            <Play size={14} />
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="p-1.5 text-muted hover:text-text transition-colors"
            title="Edit"
          >
            <Pencil size={14} />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="p-1.5 text-muted hover:text-reject transition-colors"
            title="Delete"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Expanded run history */}
      {expanded && (
        <>
          <hr className="border-border" />
          <RunHistoryPanel subscriptionId={sub.id} />
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SubscriptionsPage
// ---------------------------------------------------------------------------

export default function SubscriptionsPage() {
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const prefillGenre = searchParams.get('genre')
  const [showForm, setShowForm] = useState<
    | { mode: 'create'; initial?: Partial<SubscriptionFormData> }
    | { mode: 'edit'; sub: Subscription }
    | null
  >(null)
  const [showPresets, setShowPresets] = useState(false)

  // Auto-open create form when ?genre= is present
  useEffect(() => {
    if (prefillGenre) {
      setShowForm({
        mode: 'create',
        initial: {
          sourceConfig: { genre: prefillGenre },
          name: `${prefillGenre} Weekly`,
        },
      })
      setSearchParams({}, { replace: true })
    }
  }, [prefillGenre, setSearchParams])

  // Queries
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: getSettings,
  })

  const { data: spotifyStatus } = useQuery({
    queryKey: ['spotify-oauth-status'],
    queryFn: () => getOAuthStatus('spotify'),
  })

  const configuredSources = (() => {
    if (!settings) return []
    const sources: string[] = []
    if (settings.lastfmUsername && settings.lastfmApiKey) sources.push('lastfm')
    if (settings.listenbrainzUsername && settings.listenbrainzToken) sources.push('listenbrainz')
    if (settings.discogsUsername && settings.discogsToken) sources.push('discogs')
    if (spotifyStatus?.connected) sources.push('spotify')
    return sources
  })()

  const subscriptionMode = (settings?.preferences as Record<string, unknown> | undefined)
    ?.subscriptionMode as 'active' | 'ai-only' | null | undefined

  const { data: subscriptions, isLoading } = useQuery({
    queryKey: ['subscriptions'],
    queryFn: getSubscriptions,
  })

  const { data: schedulerInfo } = useQuery({
    queryKey: ['scheduler-info'],
    queryFn: getSchedulerInfo,
    refetchInterval: 60_000,
  })

  // Invalidation helper
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['subscriptions'] })
    queryClient.invalidateQueries({ queryKey: ['scheduler-info'] })
    queryClient.invalidateQueries({ queryKey: ['settings'] })
  }

  // Mutations
  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      updateSubscriptionApi(id, { enabled }),
    onSuccess: () => {
      invalidate()
      toast.success('Subscription updated')
    },
    onError: () => toast.error('Failed to toggle subscription'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteSubscriptionApi(id),
    onSuccess: () => {
      invalidate()
      toast.success('Subscription deleted')
    },
    onError: () => toast.error('Failed to delete subscription'),
  })

  const runNowMutation = useMutation({
    mutationFn: (id: number) => triggerSubscriptionRun(id),
    onSuccess: () => {
      invalidate()
      toast.success('Run triggered')
    },
    onError: () => toast.error('Failed to trigger run'),
  })

  const bulkMutation = useMutation({
    mutationFn: (enabled: boolean) => bulkToggleSubscriptions(enabled),
    onSuccess: (_data, enabled) => {
      invalidate()
      toast.success(enabled ? 'All subscriptions resumed' : 'All subscriptions paused')
    },
    onError: () => toast.error('Failed to update subscriptions'),
  })

  // Form handlers
  const handleCreate = async (data: SubscriptionFormData) => {
    await createSubscriptionApi(data)
    invalidate()
    setShowForm(null)
    toast.success('Subscription created')
  }

  const handleEdit = async (subId: number, data: SubscriptionFormData) => {
    await updateSubscriptionApi(subId, data)
    invalidate()
    setShowForm(null)
    toast.success('Subscription updated')
  }

  // Next run helper
  const getNextRun = (subId: number): string | null => {
    const job = schedulerInfo?.jobs.find((j) => j.name === `subscription-${subId}`)
    return job?.nextRun ?? null
  }

  const anyEnabled = subscriptions?.some((s) => s.enabled) ?? false

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-bold text-text">Subscriptions</h1>
        <div className="flex items-center gap-2">
          {subscriptions && subscriptions.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setShowPresets((v) => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted border border-border rounded-md hover:text-text hover:border-accent/40 transition-colors"
              >
                <LayoutGrid size={14} />
                Presets
              </button>
              <button
                type="button"
                onClick={() => bulkMutation.mutate(!anyEnabled)}
                disabled={bulkMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted border border-border rounded-md hover:text-text hover:border-accent/40 disabled:opacity-60 transition-colors"
              >
                {anyEnabled ? <Pause size={14} /> : <Play size={14} />}
                {anyEnabled ? 'Pause All' : 'Resume All'}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setShowForm({ mode: 'create' })}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-accent-fg rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Plus size={14} />
            New
          </button>
        </div>
      </div>

      <Hint id="subscriptions-intro-tip" type="spotlight">
        Subscriptions automatically discover new artists on a schedule. Create a genre or
        similar-artist subscription to grow your library while you sleep.
      </Hint>

      {/* Loading state */}
      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-surface border border-border rounded-lg p-4 space-y-3">
              <div className="flex items-start gap-3">
                <Skeleton className="h-4 w-4 mt-0.5 shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-64" />
                  <Skeleton className="h-3 w-40" />
                </div>
                <Skeleton className="h-5 w-10 rounded-full shrink-0" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading &&
        subscriptions &&
        subscriptions.length === 0 &&
        (subscriptionMode === 'ai-only' ? (
          <div className="bg-surface border border-border rounded-lg px-4 py-12 text-center space-y-3">
            <p className="text-sm font-medium text-text">AI-only mode</p>
            <p className="text-xs text-muted">
              Discovery runs on the pipeline schedule with no external feed subscriptions.
            </p>
            <button
              type="button"
              onClick={() => setShowPresets(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted border border-border rounded-md hover:text-text hover:border-accent/40 transition-colors"
            >
              <LayoutGrid size={14} />
              Switch to a preset
            </button>
          </div>
        ) : (
          <div className="bg-surface border border-border rounded-lg p-6 space-y-6">
            <SubscriptionPresets
              connectedServices={configuredSources}
              onComplete={() => {
                invalidate()
                setShowPresets(false)
              }}
              onCustom={() => setShowForm({ mode: 'create' })}
            />
          </div>
        ))}

      {/* Inline presets panel (shown when list is non-empty and user clicked Presets) */}
      {!isLoading && subscriptions && subscriptions.length > 0 && showPresets && (
        <div className="bg-surface border border-border rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-text">Add from presets</p>
            <button
              type="button"
              onClick={() => setShowPresets(false)}
              className="text-xs text-muted hover:text-text transition-colors"
            >
              Close
            </button>
          </div>
          <SubscriptionPresets
            connectedServices={configuredSources}
            onComplete={() => {
              invalidate()
              setShowPresets(false)
            }}
            onCustom={() => {
              setShowPresets(false)
              setShowForm({ mode: 'create' })
            }}
          />
        </div>
      )}

      {/* Subscription list */}
      {!isLoading && subscriptions && subscriptions.length > 0 && (
        <div className="space-y-3">
          {subscriptions.map((sub) => (
            <SubscriptionCard
              key={sub.id}
              sub={sub}
              nextRun={getNextRun(sub.id)}
              onEdit={() =>
                setShowForm({
                  mode: 'edit',
                  sub,
                })
              }
              onDelete={() => {
                if (confirm(`Delete "${sub.name}"?`)) {
                  deleteMutation.mutate(sub.id)
                }
              }}
              onToggle={() => toggleMutation.mutate({ id: sub.id, enabled: !sub.enabled })}
              onRunNow={() => runNowMutation.mutate(sub.id)}
            />
          ))}
        </div>
      )}

      {/* Form dialog */}
      {showForm && (
        <SubscriptionForm
          mode={showForm.mode}
          configuredSources={configuredSources}
          initial={
            showForm.mode === 'edit'
              ? {
                  name: showForm.sub.name,
                  sourceType: showForm.sub.sourceType,
                  sourceProvider: showForm.sub.sourceProvider,
                  sourceConfig: showForm.sub.sourceConfig,
                  cron: showForm.sub.cron,
                  enabled: showForm.sub.enabled,
                  maxArtistsPerRun: showForm.sub.maxArtistsPerRun,
                  action: showForm.sub.action,
                  scoreThreshold: showForm.sub.scoreThreshold,
                  scoringWeightPreset: showForm.sub.scoringWeightPreset ?? 'default',
                }
              : showForm.initial
          }
          onSubmit={async (data) => {
            if (showForm.mode === 'edit') {
              await handleEdit(showForm.sub.id, data)
            } else {
              await handleCreate(data)
            }
          }}
          onCancel={() => setShowForm(null)}
        />
      )}
    </div>
  )
}
