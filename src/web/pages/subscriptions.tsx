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
import type { MessageKey } from '@/core/i18n/messages/types'
import { ConfirmDialog } from '../components/confirm-dialog'
import { Hint } from '../components/hint'
import { ImportArtists } from '../components/import-artists'
import { SubscriptionForm, type SubscriptionFormData } from '../components/subscription-form'
import { SubscriptionPresets } from '../components/subscription-presets'
import { Skeleton } from '../components/ui/skeleton'
import {
  bulkToggleSubscriptions,
  createSubscriptionApi,
  deleteSubscriptionApi,
  getDiscoveryModes,
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
import { formatDuration } from '../lib/format-time'
import { useI18n } from '../lib/i18n'
import { formatShortDateTime } from '../lib/intl'

function formatDate(
  locale: string,
  t: (key: MessageKey) => string,
  dateStr: string | null,
): string {
  if (!dateStr) return t('common.never')
  return formatShortDateTime(locale as never, dateStr)
}

function formatRelative(
  locale: string,
  t: (key: MessageKey) => string,
  dateStr: string | null,
): string {
  if (!dateStr) return t('common.notAvailable')
  const date = new Date(dateStr)
  const diffMinutes = Math.round((date.getTime() - Date.now()) / 60_000)
  if (diffMinutes < 0) return t('common.overdue')

  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (diffMinutes < 60) return formatter.format(diffMinutes, 'minute')

  const diffHours = Math.round(diffMinutes / 60)
  if (diffHours < 24) return formatter.format(diffHours, 'hour')

  return formatter.format(Math.round(diffHours / 24), 'day')
}

function runStatus(
  run: SubscriptionRun,
  t: (key: MessageKey) => string,
): { label: string; className: string } {
  if (run.status === 'failed' || run.error)
    return { label: t('common.failed'), className: 'text-reject' }
  if (run.status === 'running') return { label: t('common.running'), className: 'text-accent' }
  if (run.status === 'stuck') return { label: t('common.stuck'), className: 'text-amber-500' }
  return { label: t('common.done'), className: 'text-approve' }
}

function RunHistoryPanel({ subscriptionId }: { subscriptionId: number }) {
  const { locale, t } = useI18n()
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
        <p className="text-sm text-muted">{t('subscriptions.runHistory.empty')}</p>
      </div>
    )
  }

  return (
    <div className="px-4 pb-4 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-muted text-xs uppercase tracking-wide">
            <th className="text-left px-2 py-1.5 font-medium">{t('common.date')}</th>
            <th className="text-left px-2 py-1.5 font-medium">{t('common.duration')}</th>
            <th className="text-right px-2 py-1.5 font-medium">{t('common.found')}</th>
            <th className="text-right px-2 py-1.5 font-medium">{t('common.new')}</th>
            <th className="text-left px-2 py-1.5 font-medium">{t('common.status')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {runs.map((run) => {
            const status = runStatus(run, t)
            return (
              <tr key={run.id} className="hover:bg-bg/50 transition-colors">
                <td className="px-2 py-1.5 text-text">{formatDate(locale, t, run.startedAt)}</td>
                <td className="px-2 py-1.5 text-muted">{formatDuration(run.durationMs)}</td>
                <td className="px-2 py-1.5 text-right text-text">
                  {(run.metadata?.artistsFound as number) ?? 0}
                </td>
                <td className="px-2 py-1.5 text-right text-text">
                  {(run.metadata?.artistsNew as number) ?? 0}
                </td>
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
  const { locale, t } = useI18n()
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
    if (sub.sourceType === 'spotify-liked-songs') return t('subscriptions.likedSongs')
    if (sub.sourceType === 'spotify-playlist') return (cfg.playlistName as string) ?? null
    if (sub.sourceType === 'discovery-mode') return (cfg.modeId as string) ?? null
    return null
  })()

  const actionLabel = t('subscriptions.addToRecommendations')

  return (
    <div className="bg-surface border border-border rounded-lg">
      <div className="p-4 flex items-start gap-3">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-0.5 text-muted hover:text-text transition-colors shrink-0"
          aria-label={
            expanded ? t('subscriptions.collapseRunHistory') : t('subscriptions.expandRunHistory')
          }
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
                {t('subscriptions.nextRun')}{' '}
                <span className="text-text">{formatRelative(locale, t, nextRun)}</span>
              </span>
            )}
            <span>
              {t('subscriptions.lastRun')}{' '}
              <span className="text-text">{formatDate(locale, t, sub.lastRunAt)}</span>
              {sub.lastResultCount != null && (
                <span className={`ml-1 ${sub.lastResultCount > 0 ? 'text-approve' : 'text-muted'}`}>
                  ({sub.lastResultCount} {t('subscriptions.foundResults')})
                </span>
              )}
            </span>
            {sub.lastError && (
              <span className="text-reject" title={sub.lastError}>
                {t('subscriptions.error')}
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
          aria-label={
            sub.enabled
              ? t('subscriptions.disableSubscription')
              : t('subscriptions.enableSubscription')
          }
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
            title={t('subscriptions.runNow')}
          >
            <Play size={14} />
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="p-1.5 text-muted hover:text-text transition-colors"
            title={t('common.edit')}
          >
            <Pencil size={14} />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="p-1.5 text-muted hover:text-reject transition-colors"
            title={t('common.delete')}
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

// SubscriptionsPage

export default function SubscriptionsPage() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const prefillGenre = searchParams.get('genre')
  const [showForm, setShowForm] = useState<
    | { mode: 'create'; initial?: Partial<SubscriptionFormData> }
    | { mode: 'edit'; sub: Subscription }
    | null
  >(null)
  const [showPresets, setShowPresets] = useState(false)
  const [confirmDeleteSub, setConfirmDeleteSub] = useState<{
    id: number
    name: string
  } | null>(null)

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

  const { data: discoveryModes } = useQuery({
    queryKey: ['discovery-modes'],
    queryFn: getDiscoveryModes,
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
      toast.success(t('subscriptions.updated'))
    },
    onError: () => toast.error(t('subscriptions.toggleFailed')),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteSubscriptionApi(id),
    onSuccess: () => {
      invalidate()
      toast.success(t('subscriptions.deleted'))
    },
    onError: () => toast.error(t('subscriptions.deleteFailed')),
  })

  const runNowMutation = useMutation({
    mutationFn: (id: number) => triggerSubscriptionRun(id),
    onSuccess: () => {
      invalidate()
      toast.success(t('subscriptions.runTriggered'))
    },
    onError: () => toast.error(t('subscriptions.runTriggerFailed')),
  })

  const bulkMutation = useMutation({
    mutationFn: (enabled: boolean) => bulkToggleSubscriptions(enabled),
    onSuccess: (_data, enabled) => {
      invalidate()
      toast.success(enabled ? t('subscriptions.allResumed') : t('subscriptions.allPaused'))
    },
    onError: () => toast.error(t('subscriptions.updateFailed')),
  })

  // Form handlers
  const handleCreate = async (data: SubscriptionFormData) => {
    await createSubscriptionApi(data)
    invalidate()
    setShowForm(null)
    toast.success(t('subscriptions.created'))
  }

  const handleEdit = async (subId: number, data: SubscriptionFormData) => {
    await updateSubscriptionApi(subId, data)
    invalidate()
    setShowForm(null)
    toast.success(t('subscriptions.updated'))
  }

  // Next run helper
  const getNextRun = (subId: number): string | null => {
    const job = schedulerInfo?.jobs.find((j) => j.name === `subscription-${subId}`)
    return job?.nextRun ?? null
  }

  const anyEnabled = subscriptions?.some((s) => s.enabled) ?? false

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-bold text-text">{t('subscriptions.title')}</h1>
        <div className="flex items-center gap-2">
          {subscriptions && subscriptions.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setShowPresets((v) => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted border border-border rounded-md hover:text-text hover:border-accent/40 transition-colors"
              >
                <LayoutGrid size={14} />
                {t('subscriptions.presets')}
              </button>
              <button
                type="button"
                onClick={() => bulkMutation.mutate(!anyEnabled)}
                disabled={bulkMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted border border-border rounded-md hover:text-text hover:border-accent/40 disabled:opacity-60 transition-colors"
              >
                {anyEnabled ? <Pause size={14} /> : <Play size={14} />}
                {anyEnabled ? t('subscriptions.pauseAll') : t('subscriptions.resumeAll')}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setShowForm({ mode: 'create' })}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-accent-fg rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Plus size={14} />
            {t('subscriptions.new')}
          </button>
        </div>
      </div>

      <Hint id="subscriptions-intro-tip" type="spotlight">
        {t('subscriptions.introTip')}
      </Hint>

      <ImportArtists
        spotifyConnected={spotifyStatus?.connected ?? false}
        defaultExpanded={!subscriptions || subscriptions.length === 0}
        onImportStarted={invalidate}
      />

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
      {!isLoading && subscriptions && subscriptions.length === 0 && (
        <div className="space-y-4">
          <p className="text-sm text-muted">{t('subscriptions.emptyDescription')}</p>
          {subscriptionMode === 'ai-only' && !showPresets ? (
            <div className="bg-surface border border-border rounded-lg px-4 py-12 text-center space-y-3">
              <p className="text-sm font-medium text-text">{t('subscriptions.aiOnlyMode')}</p>
              <p className="text-xs text-muted">{t('subscriptions.aiOnlyDescription')}</p>
              <button
                type="button"
                onClick={() => setShowPresets(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted border border-border rounded-md hover:text-text hover:border-accent/40 transition-colors"
              >
                <LayoutGrid size={14} />
                {t('subscriptions.switchToPreset')}
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
          )}
        </div>
      )}

      {/* Inline presets panel (shown when list is non-empty and user clicked Presets) */}
      {!isLoading && subscriptions && subscriptions.length > 0 && showPresets && (
        <div className="bg-surface border border-border rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-text">{t('subscriptions.addFromPresets')}</p>
            <button
              type="button"
              onClick={() => setShowPresets(false)}
              className="text-xs text-muted hover:text-text transition-colors"
            >
              {t('common.close')}
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
              onDelete={() => setConfirmDeleteSub({ id: sub.id, name: sub.name })}
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
          discoveryModes={discoveryModes?.modes ?? []}
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
      {confirmDeleteSub && (
        <ConfirmDialog
          title={t('subscriptions.deleteSubscription')}
          message={`${t('subscriptions.deleteSubscriptionPrompt')} "${confirmDeleteSub.name}"? ${t('common.cannotBeUndone')}`}
          confirmLabel={t('common.delete')}
          onConfirm={() => {
            deleteMutation.mutate(confirmDeleteSub.id)
            setConfirmDeleteSub(null)
          }}
          onCancel={() => setConfirmDeleteSub(null)}
        />
      )}
    </div>
  )
}
