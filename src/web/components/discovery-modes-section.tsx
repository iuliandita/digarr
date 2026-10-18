import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, History, LayoutGrid, Play, Plus, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  type DiscoveryModeResponse,
  getCurrentUser,
  getDiscoveryModes,
  getJob,
  getSettings,
  type JobRun,
  listJobs,
  runDiscoveryMode,
  updateSettings,
} from '../lib/api'
import {
  translateDiscoveryModeDescription,
  translateDiscoveryModeLabel,
  translateDiscoveryReason,
} from '../lib/discovery-i18n'
import { waitForDiscoveryRunCompletion } from '../lib/discovery-run-feedback'
import { useI18n } from '../lib/i18n'
import { formatShortDateTime } from '../lib/intl'
import { prefersReducedMotion } from '../lib/utils'
import { type ConnectionChoice, ConnectionPicker } from '../pages/settings/connection-picker'
import SubscriptionsPage from '../pages/subscriptions'
import { DiscoveryModeForm } from './discovery-mode-form'
import type { SubscriptionFormData } from './subscription-form'
import { Button } from './ui/button'

function jobModeId(job: JobRun): string | null {
  const metadata = job.metadata?.discoveryMode
  if (!metadata || typeof metadata !== 'object' || !('modeId' in metadata)) return null
  return typeof metadata.modeId === 'string' ? metadata.modeId : null
}

export function DiscoveryModesSection({ requestedModeId }: { requestedModeId?: string | null }) {
  const { locale, t } = useI18n()
  const queryClient = useQueryClient()
  const [pickerOpen, setPickerOpen] = useState(false)
  const addButton = useRef<HTMLButtonElement>(null)
  const [selectedModeId, setSelectedModeId] = useState<string | null>(requestedModeId ?? null)
  const [showAddFlow, setShowAddFlow] = useState(0)
  const [createRequest, setCreateRequest] = useState<{
    id: number
    initial: Partial<SubscriptionFormData>
  } | null>(null)
  const [localHistory, setLocalHistory] = useState<{ userId: number; items: JobRun[] } | null>(null)
  const [historyModeId, setHistoryModeId] = useState<string | null>(null)
  const { data: currentUser } = useQuery({ queryKey: ['currentUser'], queryFn: getCurrentUser })
  const currentUserId = currentUser?.id
  useEffect(() => {
    setLocalHistory(null)
    if (currentUserId === undefined) return
    try {
      const parsed: unknown = JSON.parse(
        localStorage.getItem(`digarr:discovery-runs:${currentUserId}`) ?? '[]',
      )
      const items = Array.isArray(parsed)
        ? parsed
            .filter(
              (item): item is JobRun =>
                !!item &&
                typeof item === 'object' &&
                item.userId === currentUserId &&
                typeof item.startedAt === 'string' &&
                Number.isFinite(Date.parse(item.startedAt)) &&
                !!item.metadata &&
                typeof item.metadata === 'object',
            )
            .slice(0, 30)
        : []
      setLocalHistory({ userId: currentUserId, items })
    } catch {
      setLocalHistory({ userId: currentUserId, items: [] })
    }
  }, [currentUserId])
  useEffect(() => {
    if (!localHistory || localHistory.userId !== currentUser?.id) return
    try {
      localStorage.setItem(
        `digarr:discovery-runs:${localHistory.userId}`,
        JSON.stringify(localHistory.items),
      )
    } catch {
      /* Browser storage may be disabled. */
    }
  }, [localHistory, currentUser?.id])
  const { data: discoveryModes } = useQuery({
    queryKey: ['discovery-modes'],
    queryFn: getDiscoveryModes,
    staleTime: 60_000,
  })
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings })
  const { data: jobs } = useQuery({
    queryKey: ['discovery-mode-jobs', currentUser?.id],
    queryFn: () => listJobs({ type: 'quick_discover', limit: 100 }),
    refetchInterval: 30_000,
    enabled: currentUser?.isAdmin === true,
  })
  const experimental =
    (settings?.preferences as { showExperimentalIntegrations?: boolean } | undefined)
      ?.showExperimentalIntegrations ?? false
  const experimentalMutation = useMutation({
    mutationFn: (value: boolean) =>
      updateSettings({ preferences: { showExperimentalIntegrations: value } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['settings'] })
    },
    onError: () => toast.error(t('common.unknownError')),
  })

  useEffect(() => {
    if (requestedModeId) setSelectedModeId(requestedModeId)
  }, [requestedModeId])
  useEffect(() => {
    if (!selectedModeId || !discoveryModes) return
    const frame = requestAnimationFrame(() => {
      const panel = document.getElementById(`discovery-mode-${selectedModeId}`)
      panel?.scrollIntoView({
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        block: 'center',
      })
      panel?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [selectedModeId, discoveryModes])

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['recommendations'] })
    void queryClient.invalidateQueries({ queryKey: ['discovery-mode-jobs'] })
  }, [queryClient])
  const handleRun = useCallback(
    async (body: Record<string, unknown>) => {
      const result = await runDiscoveryMode(body)
      if (typeof body.modeId === 'string' && currentUser) {
        const config = {
          modeId: body.modeId,
          settingsMode: body.settingsMode,
          settings: body.normalizedSettings,
          providerContext: body.providerContext,
          fallbackPolicy: body.fallbackPolicy,
        }
        const job: JobRun = {
          id: result.jobId ?? -Date.now(),
          type: 'quick_discover',
          status: 'started',
          userId: currentUser.id,
          startedAt: new Date().toISOString(),
          completedAt: null,
          durationMs: null,
          error: null,
          sourceResults: null,
          subscriptionId: null,
          batchId: null,
          metadata: { discoveryMode: { modeId: body.modeId }, savedConfig: config },
        }
        setLocalHistory((previous) => ({
          userId: currentUser.id,
          items: [job, ...(previous?.userId === currentUser.id ? previous.items : [])].slice(0, 30),
        }))
      }
      toast.success(t('discover.discoveryRunStarted'))
      if (currentUser?.isAdmin && typeof result.jobId === 'number') {
        void waitForDiscoveryRunCompletion(result.jobId, {
          getJob,
          onCompleted: refresh,
          onFailed: (job) => {
            refresh()
            toast.error(job.error ?? t('common.failed'))
          },
        })
      }
      refresh()
    },
    [currentUser, refresh, t],
  )

  const scheduleMode = (mode: DiscoveryModeResponse, config: Record<string, unknown>) => {
    setCreateRequest({
      id: Date.now(),
      initial: {
        name: translateDiscoveryModeLabel(t, mode),
        sourceType: 'discovery-mode',
        sourceProvider: mode.id,
        sourceConfig: config,
      },
    })
    setSelectedModeId(null)
  }
  const requestHandled = useCallback(() => setCreateRequest(null), [])
  const recentByMode = new Map<string, JobRun>()
  const ownLocalJobs = localHistory?.userId === currentUser?.id ? (localHistory?.items ?? []) : []
  const ownJobs = (currentUser ? (jobs?.items ?? []) : []).filter(
    (job) => job.userId === currentUser?.id,
  )
  const allJobs = [
    ...ownJobs,
    ...ownLocalJobs.filter((local) => !ownJobs.some((job) => job.id === local.id)),
  ].sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))
  const runConfigs = Object.fromEntries(
    ownLocalJobs
      .slice()
      .reverse()
      .map((job) => [jobModeId(job), job.metadata.savedConfig as Record<string, unknown>]),
  )
  for (const job of allJobs) {
    const id = jobModeId(job)
    if (id && !recentByMode.has(id) && discoveryModes?.modes.some((mode) => mode.id === id))
      recentByMode.set(id, job)
  }
  const choices: ConnectionChoice[] = (discoveryModes?.modes ?? [])
    .filter((mode) => experimental || mode.stability !== 'experimental')
    .map((mode) => ({
      id: mode.id,
      name: translateDiscoveryModeLabel(t, mode),
      descriptionText: translateDiscoveryModeDescription(t, mode),
      group: 'discover.discoveryModes',
      icon: <Play size={18} className="text-accent-text" />,
      experimental: mode.stability === 'experimental',
      detail:
        mode.availability.enabled && mode.availability.fallbackUsed
          ? translateDiscoveryReason(t, mode.availability.reason) || undefined
          : undefined,
      unavailableReason: mode.availability.enabled
        ? undefined
        : translateDiscoveryReason(t, mode.availability.reason) || t('discoveryMode.unavailable'),
    }))
  const renderModeForm = (mode: DiscoveryModeResponse) => (
    <article
      id={`discovery-mode-${mode.id}`}
      tabIndex={-1}
      aria-label={translateDiscoveryModeLabel(t, mode)}
      className="scroll-mt-24 space-y-4 rounded-lg border border-border bg-surface p-4 outline-none focus:ring-1 focus:ring-accent"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-text">
            {translateDiscoveryModeLabel(t, mode)}
          </h3>
          <p className="text-sm text-muted">{translateDiscoveryModeDescription(t, mode)}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('common.close')}
          onClick={() => setSelectedModeId(null)}
        >
          <X size={16} />
        </Button>
      </div>
      <DiscoveryModeForm
        key={mode.id}
        mode={mode}
        onRun={handleRun}
        onSchedule={(config) => scheduleMode(mode, config)}
        initialSettingsMode={runConfigs[mode.id]?.settingsMode === 'advanced' ? 'advanced' : 'easy'}
        initialSettings={runConfigs[mode.id]?.settings as Record<string, unknown> | undefined}
      />
    </article>
  )
  const selectedMode = discoveryModes?.modes.find((mode) => mode.id === selectedModeId)
  const recentRows =
    recentByMode.size > 0 ? (
      <div className="space-y-2">
        {[...recentByMode].map(([id, job]) => {
          const mode = discoveryModes?.modes.find((item) => item.id === id)
          if (!mode) return null
          const expanded = selectedModeId === id
          const label = translateDiscoveryModeLabel(t, mode)
          const running = job.status === 'running' || job.status === 'pending'
          const failed = job.status === 'failed' || !!job.error
          return (
            <article key={id} className="rounded-lg border border-border bg-surface">
              <div className="flex flex-wrap items-center gap-3 p-4">
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={`recent-mode-${id}`}
                  onClick={() => setSelectedModeId(expanded ? null : id)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  {expanded ? (
                    <ChevronDown size={16} className="shrink-0 text-muted" />
                  ) : (
                    <ChevronRight size={16} className="shrink-0 text-muted" />
                  )}
                  <span className="min-w-0 space-y-1">
                    <span className="block text-sm font-medium text-text">{label}</span>
                    <span className="block text-xs text-muted">
                      {t('discoveryModes.recentlyRun')} -{' '}
                      {formatShortDateTime(locale as never, job.startedAt)} -{' '}
                      <span
                        className={
                          failed ? 'text-reject' : running ? 'text-accent-text' : 'text-muted'
                        }
                      >
                        {failed
                          ? t('common.failed')
                          : running
                            ? t('common.running')
                            : typeof job.metadata.artistsDiscovered === 'number'
                              ? `${job.metadata.artistsDiscovered} ${t('subscriptions.foundResults')}`
                              : job.status === 'started'
                                ? t('common.notAvailable')
                                : t('common.done')}
                      </span>
                    </span>
                  </span>
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`${t('subscriptions.runNow')} ${label}`}
                  onClick={() => setSelectedModeId(id)}
                >
                  <Play size={14} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`${t('discoveryModes.runHistory')} ${label}`}
                  aria-expanded={historyModeId === id}
                  onClick={() => setHistoryModeId(historyModeId === id ? null : id)}
                >
                  <History size={14} />
                </Button>
              </div>
              {historyModeId === id && (
                <ul className="space-y-2 border-t border-border p-4 text-xs text-muted">
                  {allJobs
                    .filter((run) => jobModeId(run) === id)
                    .map((run) => (
                      <li key={run.id}>
                        {formatShortDateTime(locale as never, run.startedAt)} -{' '}
                        {run.error ??
                          (run.status === 'started'
                            ? t('discover.discoveryRunStarted')
                            : run.status === 'failed'
                              ? t('common.failed')
                              : run.status === 'running'
                                ? t('common.running')
                                : t('common.done'))}
                      </li>
                    ))}
                </ul>
              )}
              <div id={`recent-mode-${id}`}>{expanded && renderModeForm(mode)}</div>
            </article>
          )
        })}
      </div>
    ) : null

  return (
    <div className="space-y-4">
      <SubscriptionsPage
        embedded
        createRequest={createRequest}
        onCreateRequestHandled={requestHandled}
        showAddFlow={showAddFlow}
        recentModes={recentRows}
        addAction={
          <Button
            ref={addButton}
            size="sm"
            aria-expanded={pickerOpen}
            aria-controls="connection-picker"
            onClick={() => {
              setPickerOpen(!pickerOpen)
              setSelectedModeId(null)
            }}
          >
            <Plus size={14} aria-hidden="true" />
            {t('discoveryModes.runMode')}
          </Button>
        }
      />
      {pickerOpen && (
        <ConnectionPicker
          choices={choices}
          footer={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setShowAddFlow((request) => request + 1)
                setPickerOpen(false)
              }}
            >
              <LayoutGrid size={14} aria-hidden="true" />
              {t('discoveryModes.presetsAndImports')}
            </Button>
          }
          labels={{
            title: t('discoveryModes.runMode'),
            search: t('discoveryModes.searchModes'),
            results: t('discoveryModes.modeResults'),
            empty: t('discoveryModes.noModesFound'),
          }}
          onPick={(id) => {
            setSelectedModeId(id)
            setPickerOpen(false)
          }}
          onClose={() => {
            setPickerOpen(false)
            addButton.current?.focus()
          }}
          experimental={experimental}
          onExperimentalChange={
            currentUser?.isAdmin ? (value) => experimentalMutation.mutate(value) : undefined
          }
          saving={experimentalMutation.isPending}
        />
      )}
      {selectedMode && !recentByMode.has(selectedMode.id) && renderModeForm(selectedMode)}
    </div>
  )
}
