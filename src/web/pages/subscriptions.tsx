import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronDown,
  ChevronRight,
  History,
  LayoutGrid,
  Pause,
  Play,
  Plus,
  Trash2,
} from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import type { MessageKey } from '@/core/i18n/messages/types'
import { ConfirmDialog } from '../components/confirm-dialog'
import { describeCron } from '../components/cron-picker'
import { DashboardCardToggle } from '../components/dashboard-card-toggle'
import { ImportArtists } from '../components/import-artists'
import {
  buildSubscriptionUpdate,
  SubscriptionForm,
  type SubscriptionFormData,
} from '../components/subscription-form'
import { SubscriptionPresets } from '../components/subscription-presets'
import { Button } from '../components/ui/button'
import { PageHeader } from '../components/ui/page-header'
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
import { translateDiscoveryModeLabel } from '../lib/discovery-i18n'
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
  if (run.status === 'running') return { label: t('common.running'), className: 'text-accent-text' }
  if (run.status === 'stuck') return { label: t('common.stuck'), className: 'text-warning' }
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

// Brand names for the provider ids stored on a subscription.
const PROVIDER_NAMES: Record<string, string> = {
  lastfm: 'Last.fm',
  listenbrainz: 'ListenBrainz',
  discogs: 'Discogs',
  spotify: 'Spotify',
  deezer: 'Deezer',
  tidal: 'TIDAL',
}

function SubscriptionCard({
  sub,
  nextRun,
  onEdit,
  onDelete,
  onToggle,
  onRunNow,
  expanded,
  editor,
}: {
  sub: Subscription
  nextRun: string | null
  onEdit: () => void
  onDelete: () => void
  onToggle: () => void
  onRunNow: () => void
  expanded: boolean
  editor: ReactNode
}) {
  const { locale, t } = useI18n()
  const [historyOpen, setHistoryOpen] = useState(false)

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
    if (sub.sourceType === 'discovery-mode') {
      const modeId = cfg.modeId as string | undefined
      if (!modeId) return null
      const label = translateDiscoveryModeLabel(t, { id: modeId, label: modeId })
      return label === modeId ? null : label
    }
    return null
  })()

  const actionLabel = t('subscriptions.addToRecommendations')

  return (
    <div data-testid="subscription-card" className="bg-surface border border-border rounded-lg">
      <div className="p-4 flex flex-wrap items-start gap-3">
        <button
          type="button"
          onClick={onEdit}
          aria-expanded={expanded}
          aria-controls={`subscription-edit-${sub.id}`}
          className="mt-0.5 text-muted hover:text-text transition-colors shrink-0"
          aria-label={`${t('common.edit')} ${sub.name}`}
        >
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>

        {/* Info */}
        <div className="flex-1 basis-40 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={onEdit}
              aria-expanded={expanded}
              aria-controls={`subscription-edit-${sub.id}`}
              className="font-medium text-text truncate text-left hover:text-accent-text"
            >
              {sub.name}
            </button>
            <span className="text-xs text-muted">
              {sub.enabled ? t('discoveryModes.scheduled') : t('discoveryModes.paused')}
            </span>
            {sourceLabel && sourceLabel !== sub.name && (
              <span className="text-xs px-2 py-0.5 bg-accent/5 text-accent-text rounded-full min-w-0 max-w-full break-words">
                {sourceLabel}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted flex-wrap">
            {sub.sourceType !== 'discovery-mode' && (
              <span>
                {Array.isArray((sub.sourceConfig as Record<string, unknown>)?.providers)
                  ? ((sub.sourceConfig as Record<string, unknown>).providers as string[])
                      .map((id) => PROVIDER_NAMES[id] ?? id)
                      .join(', ')
                  : (PROVIDER_NAMES[sub.sourceProvider] ?? sub.sourceProvider)}
              </span>
            )}
            <span>{actionLabel}</span>
            <span title={sub.cron}>{describeCron(t, sub.cron)}</span>
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
          aria-pressed={sub.enabled}
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
            className="p-1.5 text-muted hover:text-accent-text transition-colors"
            aria-label={t('subscriptions.runNow')}
            title={t('subscriptions.runNow')}
          >
            <Play size={14} />
          </button>
          <button
            type="button"
            onClick={() => setHistoryOpen(!historyOpen)}
            aria-expanded={historyOpen}
            className="p-1.5 text-muted hover:text-text transition-colors"
            aria-label={t('discoveryModes.runHistory')}
            title={t('discoveryModes.runHistory')}
          >
            <History size={14} />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="p-1.5 text-muted hover:text-reject transition-colors"
            aria-label={t('common.delete')}
            title={t('common.delete')}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {expanded && (
        <div id={`subscription-edit-${sub.id}`} className="border-t border-border">
          {editor}
        </div>
      )}
      {historyOpen && (
        <>
          <hr className="border-border" />
          <RunHistoryPanel subscriptionId={sub.id} />
        </>
      )}
    </div>
  )
}

// SubscriptionsPage

export default function SubscriptionsPage({
  embedded = false,
  addAction,
  createRequest,
  onCreateRequestHandled,
  showAddFlow = 0,
  recentModes,
}: {
  embedded?: boolean
  addAction?: ReactNode
  createRequest?: { id: number; initial: Partial<SubscriptionFormData> } | null
  onCreateRequestHandled?: () => void
  showAddFlow?: number
  recentModes?: ReactNode
} = {}) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const prefillGenre = searchParams.get('genre')
  const [showForm, setShowForm] = useState<
    | { mode: 'create'; initial?: Partial<SubscriptionFormData>; requestId?: number }
    | { mode: 'edit'; sub: Subscription }
    | null
  >(null)
  const [showPresets, setShowPresets] = useState(false)
  const [confirmDeleteSub, setConfirmDeleteSub] = useState<{
    id: number
    name: string
  } | null>(null)

  useEffect(() => {
    if (!createRequest) return
    setShowForm({ mode: 'create', initial: createRequest.initial, requestId: createRequest.id })
    onCreateRequestHandled?.()
  }, [createRequest, onCreateRequestHandled])

  useEffect(() => {
    if (showAddFlow) setShowPresets(true)
  }, [showAddFlow])

  // Auto-open create form when ?genre= is present
  useEffect(() => {
    if (prefillGenre) {
      setShowForm({
        mode: 'create',
        initial: {
          sourceConfig: { genre: prefillGenre },
          name: t('subscriptions.genreWeeklyName').replace('{genre}', prefillGenre),
        },
      })
      setSearchParams({}, { replace: true })
    }
  }, [prefillGenre, setSearchParams, t])

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

  const requestedSubscription = searchParams.get('subscription')
  useEffect(() => {
    if (!requestedSubscription || !subscriptions) return
    const sub = subscriptions.find((item) => item.id === Number(requestedSubscription))
    if (!sub) return
    setShowForm({ mode: 'edit', sub })
    setSearchParams(
      (params) => {
        const next = new URLSearchParams(params)
        next.delete('subscription')
        return next
      },
      { replace: true },
    )
    requestAnimationFrame(() => {
      const row = document.getElementById(`subscription-${sub.id}`)
      row?.scrollIntoView({ block: 'center' })
      row?.querySelector<HTMLButtonElement>('button[aria-expanded]')?.focus()
    })
  }, [requestedSubscription, subscriptions, setSearchParams])

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
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] })
      toast.error(t('subscriptions.runTriggerFailed'))
    },
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
    const update = buildSubscriptionUpdate(data)
    delete update.enabled
    await updateSubscriptionApi(subId, update)
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

  const renderForm = (form: NonNullable<typeof showForm>, inline = false) => (
    <SubscriptionForm
      key={form.mode === 'edit' ? `edit-${form.sub.id}` : `create-${form.requestId ?? 'default'}`}
      inline={inline}
      mode={form.mode}
      configuredSources={configuredSources}
      discoveryModes={discoveryModes?.modes ?? []}
      initial={
        form.mode === 'edit'
          ? {
              name: form.sub.name,
              sourceType: form.sub.sourceType,
              sourceProvider: form.sub.sourceProvider,
              sourceConfig: form.sub.sourceConfig,
              cron: form.sub.cron,
              enabled: form.sub.enabled,
              maxArtistsPerRun: form.sub.maxArtistsPerRun,
              action: form.sub.action,
              scoreThreshold: form.sub.scoreThreshold,
              scoringWeightPreset: form.sub.scoringWeightPreset ?? 'default',
            }
          : form.initial
      }
      onSubmit={async (data) => {
        if (form.mode === 'edit') await handleEdit(form.sub.id, data)
        else await handleCreate(data)
      }}
      onCancel={() => setShowForm(null)}
    />
  )

  const actions = (
    <>
      <DashboardCardToggle cardId="subscriptions" />
      {subscriptions && subscriptions.length >= 2 && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => bulkMutation.mutate(!anyEnabled)}
          disabled={bulkMutation.isPending}
        >
          {anyEnabled ? (
            <Pause size={14} aria-hidden="true" />
          ) : (
            <Play size={14} aria-hidden="true" />
          )}
          {anyEnabled ? t('subscriptions.pauseAll') : t('subscriptions.resumeAll')}
        </Button>
      )}
      {addAction ?? (
        <Button size="sm" onClick={() => setShowForm({ mode: 'create' })}>
          <Plus size={14} aria-hidden="true" />
          {t('subscriptions.new')}
        </Button>
      )}
      {!embedded && (
        <Button variant="outline" size="sm" onClick={() => setShowPresets(!showPresets)}>
          <LayoutGrid size={14} aria-hidden="true" />
          {t('subscriptions.fromPreset')}
        </Button>
      )}
    </>
  )

  return (
    <section className={embedded ? 'space-y-4' : 'p-6 space-y-6 max-w-6xl mx-auto'}>
      {embedded ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-text">{t('discoveryModes.yourModes')}</h2>
          <div className="flex flex-wrap gap-2">{actions}</div>
        </div>
      ) : (
        <PageHeader title={t('subscriptions.title')} actions={actions} />
      )}

      {isLoading && <Skeleton className="h-20 w-full" />}
      {!isLoading && subscriptions?.length === 0 && !recentModes && (
        <p className="text-sm text-muted">{t('discoveryModes.emptyHint')}</p>
      )}
      {!isLoading && subscriptions && subscriptions.length > 0 && (
        <div className="space-y-2">
          {subscriptions.map((sub) => (
            <div key={sub.id} id={`subscription-${sub.id}`} className="scroll-mt-24">
              <SubscriptionCard
                sub={sub}
                nextRun={getNextRun(sub.id)}
                expanded={showForm?.mode === 'edit' && showForm.sub.id === sub.id}
                editor={
                  showForm?.mode === 'edit' && showForm.sub.id === sub.id
                    ? renderForm(showForm, true)
                    : null
                }
                onEdit={() =>
                  setShowForm((current) =>
                    current?.mode === 'edit' && current.sub.id === sub.id
                      ? null
                      : { mode: 'edit', sub },
                  )
                }
                onDelete={() => setConfirmDeleteSub({ id: sub.id, name: sub.name })}
                onToggle={() => toggleMutation.mutate({ id: sub.id, enabled: !sub.enabled })}
                onRunNow={() => runNowMutation.mutate(sub.id)}
              />
            </div>
          ))}
        </div>
      )}
      {recentModes}
      {showPresets && (
        <div className="bg-surface border border-border rounded-lg p-4 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium text-text">
              {t('discoveryModes.presetsAndImports')}
            </h3>
            <Button variant="ghost" size="sm" onClick={() => setShowPresets(false)}>
              {t('common.close')}
            </Button>
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
          <ImportArtists
            spotifyConnected={spotifyStatus?.connected ?? false}
            defaultExpanded
            onImportStarted={invalidate}
          />
        </div>
      )}
      {showForm?.mode === 'create' && renderForm(showForm, embedded)}
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
    </section>
  )
}
