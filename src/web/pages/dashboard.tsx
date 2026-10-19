import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { type DashboardCardId, DEFAULT_DECISIONS_GRID } from '@/core/dashboard-layout'
import { AlbumPicker } from '../components/album-picker'
import { ApproveDialog } from '../components/approve-dialog'
import { ArtistThumb } from '../components/artist-thumb'
import {
  DASHBOARD_LINKS,
  DASHBOARD_TITLES,
  DashboardCustomize,
} from '../components/dashboard-customize'
import { GenreCoverageSummary } from '../components/genre-coverage-summary'
import { Hint } from '../components/hint'
import type { MonitorOption } from '../components/monitoring-options'
import { PipelineProgress } from '../components/pipeline-progress'
import { RecentlyApproved } from '../components/recently-approved'
import {
  canApproveArtistToTarget,
  resolveApprovalTargetOptions,
  resolveDialogLidarrTarget,
} from '../components/target-utils'
import { type Recommendation, TodaysPick } from '../components/todays-pick'
import { Button } from '../components/ui/button'
import { EmptyState } from '../components/ui/empty-state'
import { Notice } from '../components/ui/notice'
import { PageHeader } from '../components/ui/page-header'
import { Skeleton } from '../components/ui/skeleton'
import { useDashboardLayout } from '../hooks/use-dashboard-layout'
import {
  ApiError,
  approveRecommendation,
  approveToTarget,
  type GenreCoverage,
  getDashboardGenreCoverage,
  getDashboardTaste,
  getRecentTracks,
  getRecommendations,
  getSchedulerInfo,
  getSubscriptions,
  getTopArtists,
  type ListeningTopRange,
  listTargets,
  type SchedulerJob,
  type Subscription,
  type TasteGenre,
  triggerPipeline,
  updateRecommendation,
} from '../lib/api'
import { reportApprovalOutcome } from '../lib/approval'
import { scanStartedMessage } from '../lib/discovery-run-feedback'
import { formatRelativeTime } from '../lib/format-time'
import { useI18n } from '../lib/i18n'

function SectionHeader({ title, linkTo }: { title: string; linkTo: string }) {
  return (
    <h2 className="mb-3 text-lead font-semibold text-text">
      <Link to={linkTo} className="hover:underline">
        {title}
      </Link>
    </h2>
  )
}

function CardViewToggle({
  value,
  onChange,
  options,
  label,
}: {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  label: string
}) {
  return (
    <fieldset aria-label={label} className="mb-3 flex flex-wrap gap-1">
      {options.map((option) => (
        <Button
          key={option.value}
          size="sm"
          variant={value === option.value ? 'secondary' : 'ghost'}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </fieldset>
  )
}

function SubscriptionPulse({
  subs,
  scheduler,
}: {
  subs: Subscription[] | undefined
  scheduler: { jobs: SchedulerJob[] } | undefined
}) {
  const { locale, t } = useI18n()
  if (!subs || subs.length === 0) {
    return (
      <div>
        <EmptyState
          className="bg-surface border border-border rounded-surface"
          message={t('dashboard.subscriptionsEmpty')}
          action={
            <Link to="/discovery-modes" className="text-caption text-accent-text underline">
              {t('dashboard.setUpAutomaticDiscovery')}
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 bg-surface border border-border rounded-lg divide-y divide-border">
        {subs.slice(0, 5).map((sub) => {
          const job = scheduler?.jobs.find((j) => j.name === `subscription-${sub.id}`)
          const nextRun = job?.nextRun ? formatRelativeTime(locale, job.nextRun) : null
          return (
            <div key={sub.id} className="flex items-center gap-3 px-4 py-2.5">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${sub.enabled ? 'bg-approve' : 'bg-muted/40'}`}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-text truncate">{sub.name}</p>
                <p className="text-xs text-muted">
                  {sub.lastResultCount != null
                    ? `${sub.lastResultCount} ${t('dashboard.foundLastRun')}`
                    : t('dashboard.noRunsYet')}
                  {nextRun && ` \u00b7 ${t('dashboard.nextRun')} ${nextRun}`}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const LISTENING_TOP_RANGES: readonly ListeningTopRange[] = [
  'this_week',
  'this_month',
  'this_year',
  'all_time',
]

function rangeLabelKey(
  r: ListeningTopRange,
): 'dashboard.thisWeek' | 'dashboard.thisMonth' | 'dashboard.thisYear' | 'dashboard.allTime' {
  return r === 'this_week'
    ? 'dashboard.thisWeek'
    : r === 'this_month'
      ? 'dashboard.thisMonth'
      : r === 'this_year'
        ? 'dashboard.thisYear'
        : 'dashboard.allTime'
}

function ListeningHistoryError({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n()
  return (
    <Notice
      tone="error"
      action={
        <Button variant="link" size="sm" className="px-2" onClick={onRetry}>
          {t('errorBoundary.retry')}
        </Button>
      }
    >
      {t('dashboard.listeningFailed')}
    </Notice>
  )
}

function ListeningHistory({
  data,
  loading,
  error,
  onRetry,
  range,
  page,
  pageSize,
  onRangeChange,
  onPageChange,
}: {
  data: Awaited<ReturnType<typeof getTopArtists>> | undefined
  loading: boolean
  error: boolean
  onRetry: () => void
  range: ListeningTopRange
  page: number
  pageSize: number
  onRangeChange: (r: ListeningTopRange) => void
  onPageChange: (p: number) => void
}) {
  const { t } = useI18n()
  const state = loading
    ? 'loading'
    : error
      ? 'error'
      : (data?.status ?? (data?.source ? 'empty' : 'not_configured'))
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const hasPrev = page > 0
  const hasNext = page + 1 < totalPages
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center justify-between mb-3 gap-2">
        <div className="flex gap-1 flex-wrap justify-end">
          {LISTENING_TOP_RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onRangeChange(r)}
              className={`text-xs px-2 py-0.5 rounded ${range === r ? 'bg-accent text-accent-fg' : 'text-muted hover:text-text'}`}
            >
              {t(rangeLabelKey(r))}
            </button>
          ))}
        </div>
      </div>
      {state === 'error' && <ListeningHistoryError onRetry={onRetry} />}
      {!data || data.tracks.length === 0 ? (
        state === 'error' ? null : (
          <EmptyState
            className="flex-1 justify-center bg-surface border border-border rounded-surface"
            message={t(
              state === 'loading'
                ? 'common.loading'
                : state === 'empty'
                  ? 'dashboard.listeningEmpty'
                  : 'dashboard.connectListening',
            )}
            action={
              state === 'not_configured' && (
                <Link
                  to="/settings?tab=connections"
                  className="text-caption text-accent-text underline"
                >
                  {t('dashboard.connectAccount')}
                </Link>
              )
            }
          />
        )
      ) : (
        <div className="flex-1 bg-surface border border-border rounded-lg">
          <div className="divide-y divide-border">
            {data.tracks.map((entry) => (
              <div
                key={`${entry.source}-${entry.artist}-${entry.track}`}
                className="flex items-center gap-3 px-4 py-2.5"
              >
                <ArtistThumb name={entry.artist} imageUrl={entry.imageUrl} size={8} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-text truncate">{entry.artist}</p>
                  <p className="text-xs text-muted truncate">{entry.track}</p>
                </div>
              </div>
            ))}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-2 border-t border-border">
              <button
                type="button"
                onClick={() => onPageChange(page - 1)}
                disabled={!hasPrev}
                className="text-xs text-muted disabled:opacity-40 disabled:cursor-not-allowed hover:text-text"
              >
                {t('dashboard.prev')}
              </button>
              <span className="text-xs text-muted">
                {page + 1} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => onPageChange(page + 1)}
                disabled={!hasNext}
                className="text-xs text-muted disabled:opacity-40 disabled:cursor-not-allowed hover:text-text"
              >
                {t('dashboard.next')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function RecentActivity({
  data,
  error,
  onRetry,
}: {
  data: Awaited<ReturnType<typeof getRecentTracks>> | undefined
  error: boolean
  onRetry: () => void
}) {
  const { t, locale } = useI18n()
  const failed = error || data?.status === 'error'
  return (
    <div>
      {failed && <ListeningHistoryError onRetry={onRetry} />}
      {!data || data.tracks.length === 0 ? (
        failed ? null : (
          <EmptyState
            className="bg-surface border border-border rounded-surface"
            message={t('dashboard.recentPlaysEmpty')}
          />
        )
      ) : (
        <div className="bg-surface border border-border rounded-lg divide-y divide-border">
          {data.tracks.map((entry) => (
            <div
              key={`${entry.source}-${entry.playedAt ?? ''}-${entry.artist}-${entry.track}`}
              className="flex items-center gap-3 px-4 py-2.5"
            >
              <ArtistThumb name={entry.artist} imageUrl={entry.imageUrl} size={8} />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-text truncate">{entry.artist}</p>
                <p className="text-xs text-muted truncate">{entry.track}</p>
              </div>
              {entry.nowPlaying ? (
                <span className="text-xs text-accent-text shrink-0">
                  {t('dashboard.nowPlaying')}
                </span>
              ) : entry.playedAt ? (
                <span className="text-xs text-muted shrink-0">
                  {formatRelativeTime(locale, entry.playedAt)}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TasteProfile({
  genres,
  coverage,
  loading,
}: {
  genres: TasteGenre[] | undefined
  coverage: GenreCoverage | null | undefined
  loading: boolean
}) {
  const { t } = useI18n()
  // Bars are relative to the top genre; shares of all genres are too small to read as bars.
  const maxPercentage = Math.max(...(genres ?? []).map((g) => g.percentage), 0)
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 bg-surface border border-border rounded-lg p-4">
        {loading ? (
          <div className="space-y-3">
            {['t1', 't2', 't3', 't4', 't5'].map((k) => (
              <Skeleton key={k} className="h-4 w-full" />
            ))}
          </div>
        ) : !genres || genres.length === 0 ? (
          <EmptyState className="py-4" message={t('dashboard.tasteEmpty')} />
        ) : (
          <div className="space-y-2.5">
            {genres.map((g, i) => (
              <div key={g.genre}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-text truncate">{g.genre}</span>
                  <span className="text-muted shrink-0 ml-2">{g.percentage}%</span>
                </div>
                <div className="h-2 bg-bg rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent rounded-full transition-[width] duration-300"
                    style={{
                      width: `${maxPercentage > 0 ? (g.percentage / maxPercentage) * 100 : 0}%`,
                      opacity: 1 - i * 0.15,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
        {coverage && coverage.totalArtists > 0 ? (
          <div className="mt-4 pt-3 border-t border-border">
            <GenreCoverageSummary coverage={coverage} />
          </div>
        ) : null}
      </div>
    </div>
  )
}

type DecisionEntry = {
  id: number
  type: 'approved' | 'rejected'
  timestamp: string
  artistName: string
}

function ActivityFeed({
  entries,
  loading,
}: {
  entries: DecisionEntry[] | undefined
  loading: boolean
}) {
  const { locale, t } = useI18n()
  return (
    <div className="bg-surface border border-border rounded-lg">
      {loading ? (
        <div className="p-4 space-y-3">
          {['a1', 'a2', 'a3', 'a4', 'a5'].map((key) => (
            <Skeleton key={key} className="h-4 w-full" />
          ))}
        </div>
      ) : !entries?.length ? (
        <EmptyState className="py-6" message={t('dashboard.activityEmpty')} />
      ) : (
        <div className="divide-y divide-border">
          {entries.map((entry) => (
            <div key={entry.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="text-xs shrink-0" aria-hidden="true">
                {entry.type === 'approved' ? '\u2713' : '\u2717'}
              </span>
              <p className="min-w-0 flex-1 text-sm text-text truncate">
                {t(
                  entry.type === 'approved'
                    ? 'dashboard.activityApproved'
                    : 'dashboard.activityRejected',
                )}{' '}
                {entry.artistName}
              </p>
              <span className="text-xs text-muted shrink-0">
                {formatRelativeTime(locale, entry.timestamp)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const APPROVED_STATUSES = new Set(['added_to_lidarr', 'add_failed', 'approved', 'waiting'])
const ACTIVITY_STATUSES = new Set(['added_to_lidarr', 'add_failed', 'approved', 'rejected'])

export function Dashboard() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const {
    layout,
    disabled: layoutDisabled,
    save: saveLayout,
    error: layoutError,
    retry: retryLayout,
  } = useDashboardLayout()
  const [customizing, setCustomizing] = useState(false)
  const [decisionsView, setDecisionsView] = useState('approved')
  const [listeningView, setListeningView] = useState('top')
  const [skippedIds, setSkippedIds] = useState<Set<number>>(new Set())
  const [actedIds, setActedIds] = useState<Set<number>>(new Set())
  const [listenRange, setListenRange] = useState<ListeningTopRange>('this_month')
  const [listenPage, setListenPage] = useState(0)
  const LISTEN_PAGE_SIZE = 5

  // Pending pick - fetch 10 so skip has runway
  const { data: pickData, isLoading: pickLoading } = useQuery({
    queryKey: ['dashboard-pick'],
    queryFn: () => getRecommendations({ status: 'pending', sort: 'score_desc', limit: '10' }),
    staleTime: 30_000,
  })

  // Recently approved
  const decisionsGrid = layout.decisionsGrid ?? DEFAULT_DECISIONS_GRID
  const approvedLimit = decisionsGrid.columns * decisionsGrid.rows
  const { data: approvedData, isLoading: approvedLoading } = useQuery({
    queryKey: ['dashboard-approved', approvedLimit],
    queryFn: () =>
      getRecommendations({
        status: 'added_to_lidarr,add_failed,approved,waiting',
        sort: 'acted_on_desc',
        limit: String(approvedLimit),
      }),
    staleTime: 30_000,
  })

  // Subscriptions
  const { data: subsData } = useQuery({
    queryKey: ['subscriptions'],
    queryFn: getSubscriptions,
    staleTime: 30_000,
  })

  // Scheduler
  const { data: schedulerData } = useQuery({
    queryKey: ['scheduler-info'],
    queryFn: getSchedulerInfo,
    staleTime: 30_000,
  })

  // Listening history (top artists)
  const {
    data: topArtistsData,
    isPending: topArtistsLoading,
    isError: topArtistsError,
    refetch: retryTopArtists,
  } = useQuery({
    queryKey: ['dashboard-top-artists', listenRange, listenPage, LISTEN_PAGE_SIZE],
    queryFn: async () => {
      const result = await getTopArtists(
        listenRange,
        listenPage * LISTEN_PAGE_SIZE,
        LISTEN_PAGE_SIZE,
      )
      if (result.status === 'error') throw new Error('Listening source failed')
      return result
    },
    staleTime: 30_000,
  })

  // Recent activity (latest scrobbles)
  const {
    data: recentTracksData,
    isError: recentTracksError,
    refetch: retryRecentTracks,
  } = useQuery({
    queryKey: ['dashboard-recent-tracks'],
    queryFn: async () => {
      const result = await getRecentTracks(5)
      if (result.status === 'error') throw new Error('Listening source failed')
      return result
    },
    staleTime: 30_000,
  })

  // Taste
  const { data: tasteData, isLoading: tasteLoading } = useQuery({
    queryKey: ['dashboard-taste'],
    queryFn: getDashboardTaste,
    staleTime: 30_000,
  })

  const { data: genreCoverageData } = useQuery({
    queryKey: ['dashboard-genre-coverage'],
    queryFn: getDashboardGenreCoverage,
    staleTime: 30_000,
  })

  // Activity
  const { data: activityData, isLoading: activityLoading } = useQuery({
    queryKey: ['dashboard-activity'],
    queryFn: async () => {
      const result = await getRecommendations({
        status: 'added_to_lidarr,add_failed,approved,rejected',
        sort: 'acted_on_desc',
        limit: '5',
      })
      return (
        result.items as (Recommendation & { actedOnAt: string | null; createdAt: string })[]
      ).map(
        (rec): DecisionEntry => ({
          id: rec.id,
          type: rec.status === 'rejected' ? 'rejected' : 'approved',
          timestamp: rec.actedOnAt ?? rec.createdAt,
          artistName: rec.artist.name,
        }),
      )
    },
    staleTime: 30_000,
  })

  // Targets (for multi-target approve dropdown)
  const { data: targetsData } = useQuery({
    queryKey: ['targets'],
    queryFn: listTargets,
    staleTime: 60_000,
  })

  const targets = targetsData ?? []
  const approveTargets = targets.filter(
    (target) => target.enabled && target.owned && canApproveArtistToTarget(target.type),
  )
  const hasLidarrTarget = approveTargets.some((target) => target.type === 'lidarr')

  // ApproveDialog state (Lidarr profile picker)
  const [approveDialogState, setApproveDialogState] = useState<{
    recId: number
    monitorOption: MonitorOption
    targetId?: string
  } | null>(null)
  const [albumPickerRec, setAlbumPickerRec] = useState<Recommendation | null>(null)

  const allPending = (pickData?.items ?? []) as Recommendation[]

  // Daily pick rotation: use date as seed to show a different rec each day.
  // Pool is filtered to recs the user hasn't acted on this session.
  const currentPick = (() => {
    const pool = allPending.filter((r) => !skippedIds.has(r.id) && !actedIds.has(r.id))
    if (pool.length === 0) return null
    const day = new Date().toDateString()
    const hash = [...day].reduce((acc, c) => acc * 31 + c.charCodeAt(0), 0)
    return pool[Math.abs(hash) % pool.length] ?? null
  })()

  // Recently approved recs for the gallery
  const approvedRecs = (approvedData?.items ?? []) as Recommendation[]

  // Refetch only the cards an outcome changes. The acted pick stays hidden via
  // actedIds, so the pick list reloads only once the local pool runs out.
  function refreshAfterAction(id: number, status: string | undefined, approval: boolean) {
    const poolLeft = allPending.some(
      (r) => r.id !== id && !skippedIds.has(r.id) && !actedIds.has(r.id),
    )
    void queryClient.invalidateQueries({
      queryKey: ['dashboard-pick'],
      refetchType: poolLeft ? 'none' : 'active',
    })
    if (approval) void queryClient.invalidateQueries({ queryKey: ['approval-requests'] })
    if (status === undefined || APPROVED_STATUSES.has(status))
      void queryClient.invalidateQueries({ queryKey: ['dashboard-approved'] })
    if (status === undefined || ACTIVITY_STATUSES.has(status))
      void queryClient.invalidateQueries({ queryKey: ['dashboard-activity'] })
  }

  async function handleAction(id: number, status: 'approved' | 'rejected') {
    setActedIds((prev) => new Set([...prev, id]))
    try {
      const res = await (status === 'approved'
        ? approveRecommendation(id)
        : updateRecommendation(id, { status }))
      if (reportApprovalOutcome(res, t)) {
        toast.success(
          status === 'approved' ? t('dashboard.approvedSuccess') : t('dashboard.rejectedSuccess'),
        )
      }
      refreshAfterAction(id, res?.status, status === 'approved')
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('dashboard.actionFailed'))
      setActedIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  async function handleApproveWithOption(recId: number, monitorOption: MonitorOption) {
    if (hasLidarrTarget) {
      setApproveDialogState({ recId, monitorOption })
      return
    }

    setActedIds((prev) => new Set([...prev, recId]))
    try {
      const res = await approveRecommendation(recId, { monitorOption })
      if (reportApprovalOutcome(res, t)) toast.success(t('dashboard.approvedSuccess'))
      refreshAfterAction(recId, res?.status, true)
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('dashboard.actionFailed'))
      setActedIds((prev) => {
        const next = new Set(prev)
        next.delete(recId)
        return next
      })
    }
  }

  function handleOpenAlbumPicker(recId: number) {
    const rec = currentPick?.id === recId ? currentPick : null
    if (!rec?.artist.mbid) {
      toast.error(t('dashboard.actionFailed'))
      return
    }
    setAlbumPickerRec(rec)
  }

  async function handleApproveToTarget(recId: number, targetId: string) {
    const target = targets.find(
      (t) => `${t.type}-${t.id}` === targetId || String(t.id) === targetId,
    )
    if (target?.type === 'lidarr') {
      setApproveDialogState({ recId, monitorOption: 'none', targetId })
      return
    }

    setActedIds((prev) => new Set([...prev, recId]))
    try {
      const targetOptions = resolveApprovalTargetOptions(targets, targetId)
      const res = await approveToTarget(recId, targetId, {
        ...targetOptions,
      })
      if (reportApprovalOutcome(res, t)) toast.success(t('dashboard.sentToTarget'))
      refreshAfterAction(recId, res?.status, true)
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('dashboard.approveFailed'))
      setActedIds((prev) => {
        const next = new Set(prev)
        next.delete(recId)
        return next
      })
    }
  }

  function handleSkip(id: number) {
    setSkippedIds((prev) => new Set([...prev, id]))
  }

  const empty: Record<DashboardCardId, boolean> = {
    pick: !pickLoading && !currentPick,
    decisions:
      !approvedLoading && !activityLoading && !approvedRecs.length && !activityData?.length,
    listening:
      !topArtistsLoading &&
      !topArtistsError &&
      !recentTracksError &&
      !topArtistsData?.source &&
      !recentTracksData?.hasSource,
    genres: !tasteLoading && !tasteData?.length && !genreCoverageData?.totalArtists,
    subscriptions: subsData !== undefined && subsData.length === 0,
  }
  const runScan = () => {
    void triggerPipeline()
      .then((res) => toast.success(scanStartedMessage(t, res)))
      .catch(() => toast.error(t('discover.scanStartFailed')))
  }
  const content: Record<DashboardCardId, ReactNode> = {
    pick: (
      <TodaysPick
        rec={currentPick}
        loading={pickLoading}
        onApprove={(id) => handleAction(id, 'approved')}
        onReject={(id) => handleAction(id, 'rejected')}
        onSkip={handleSkip}
        onRunScan={runScan}
        targets={approveTargets}
        onApproveToTarget={handleApproveToTarget}
        onApproveWithOption={handleApproveWithOption}
        onOpenAlbumPicker={handleOpenAlbumPicker}
      />
    ),
    decisions: (
      <>
        <CardViewToggle
          label={t('dashboard.yourDecisions')}
          value={decisionsView}
          onChange={setDecisionsView}
          options={[
            { value: 'approved', label: t('discover.approved') },
            { value: 'all', label: t('discover.all') },
          ]}
        />
        {decisionsView === 'approved' ? (
          <RecentlyApproved
            recs={approvedRecs}
            loading={approvedLoading}
            columns={decisionsGrid.columns}
            count={approvedLimit}
            emptyClassName="flex-1"
          />
        ) : (
          <ActivityFeed entries={activityData} loading={activityLoading} />
        )}
      </>
    ),
    listening: (
      <>
        <CardViewToggle
          label={t('dashboard.listening')}
          value={listeningView}
          onChange={setListeningView}
          options={[
            { value: 'top', label: t('dashboard.topArtists') },
            { value: 'recent', label: t('dashboard.recentPlays') },
          ]}
        />
        {listeningView === 'top' ? (
          <ListeningHistory
            data={topArtistsData}
            loading={topArtistsLoading}
            error={topArtistsError}
            onRetry={() => {
              void retryTopArtists()
            }}
            range={listenRange}
            page={listenPage}
            pageSize={LISTEN_PAGE_SIZE}
            onRangeChange={(range) => {
              setListenRange(range)
              setListenPage(0)
            }}
            onPageChange={setListenPage}
          />
        ) : (
          <RecentActivity
            data={recentTracksData}
            error={recentTracksError}
            onRetry={() => {
              void retryRecentTracks()
            }}
          />
        )}
      </>
    ),
    genres: <TasteProfile genres={tasteData} coverage={genreCoverageData} loading={tasteLoading} />,
    subscriptions: <SubscriptionPulse subs={subsData} scheduler={schedulerData} />,
  }
  const spans = { small: 'md:col-span-1', medium: 'md:col-span-2', large: 'md:col-span-3' }

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-6xl mx-auto">
      <PageHeader
        title={t('dashboard.title')}
        actions={
          <>
            {empty.pick && !layout.showEmpty && (
              <Button onClick={runScan}>{t('app.runScan')}</Button>
            )}
            <Button
              variant="outline"
              aria-expanded={customizing}
              aria-controls="dashboard-customize"
              onClick={() => setCustomizing((value) => !value)}
            >
              {t('dashboard.customize')}
            </Button>
          </>
        }
      />
      {customizing && (
        <>
          <DashboardCustomize layout={layout} disabled={layoutDisabled} onChange={saveLayout} />
          {layoutError && (
            <Notice
              tone="error"
              action={<Button onClick={retryLayout}>{t('errorBoundary.retry')}</Button>}
            >
              {t('dashboard.layoutLoadFailed')}
            </Notice>
          )}
        </>
      )}
      <PipelineProgress
        onComplete={() => {
          for (const key of [
            'dashboard-pick',
            'approval-requests',
            'dashboard-approved',
            'dashboard-activity',
            'dashboard-genre-coverage',
          ]) {
            void queryClient.invalidateQueries({ queryKey: [key] })
          }
        }}
        isFirstScan={!pickData?.items.length && !approvedData?.items.length}
      />
      {tasteData && tasteData.length > 0 && (
        <Hint id="dashboard-feedback-tip" type="spotlight">
          {t('dashboard.feedbackTip')}
        </Hint>
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 md:grid-flow-row-dense gap-4 items-start">
        {layout.cards
          .filter((card) => card.visible && (layout.showEmpty || !empty[card.id]))
          .map((card) => (
            <section
              key={card.id}
              data-dashboard-card={card.id}
              aria-labelledby={`dashboard-${card.id}`}
              className={`@container min-w-0 ${spans[card.size]}`}
            >
              <div id={`dashboard-${card.id}`}>
                <SectionHeader
                  title={t(DASHBOARD_TITLES[card.id])}
                  linkTo={DASHBOARD_LINKS[card.id]}
                />
              </div>
              {content[card.id]}
            </section>
          ))}
      </div>

      {/* Lidarr profile picker dialog (Today's Pick target approve) */}
      {approveDialogState && (
        <ApproveDialog
          lidarrTargetId={resolveDialogLidarrTarget(targets, approveDialogState.targetId)?.id}
          monitorOption={approveDialogState.monitorOption}
          onCancel={() => setApproveDialogState(null)}
          onConfirm={async (overrides) => {
            const { recId, targetId } = approveDialogState
            setApproveDialogState(null)
            setActedIds((prev) => new Set([...prev, recId]))
            try {
              let res: Awaited<ReturnType<typeof approveToTarget>>
              if (targetId) {
                const targetOptions = resolveApprovalTargetOptions(targets, targetId)
                res = await approveToTarget(recId, targetId, {
                  ...overrides,
                  ...targetOptions,
                })
              } else {
                const dialogTarget = resolveDialogLidarrTarget(targets)
                res = await approveRecommendation(recId, {
                  ...overrides,
                  ...(dialogTarget ? { lidarrTargetId: `lidarr-${dialogTarget.id}` } : {}),
                })
              }
              if (reportApprovalOutcome(res, t)) toast.success(t('dashboard.addedToLidarr'))
              refreshAfterAction(recId, res?.status, true)
            } catch (error) {
              toast.error(
                error instanceof ApiError ? error.message : t('dashboard.addToLidarrFailed'),
              )
              setActedIds((prev) => {
                const next = new Set(prev)
                next.delete(recId)
                return next
              })
            }
          }}
        />
      )}

      {albumPickerRec?.artist.mbid &&
        (() => {
          const pickerRec = albumPickerRec
          const artistMbid = pickerRec.artist.mbid
          if (!artistMbid) return null
          return (
            <AlbumPicker
              artistMbid={artistMbid}
              artistName={pickerRec.artist.name}
              artistImageUrl={pickerRec.artist.imageUrl}
              suggestedAlbumId={pickerRec.recommendedReleaseGroupId}
              onConfirm={async (selectedAlbumIds) => {
                setAlbumPickerRec(null)
                setActedIds((prev) => new Set([...prev, pickerRec.id]))
                try {
                  const res = await approveRecommendation(pickerRec.id, {
                    monitorOption: 'selected',
                    selectedAlbumIds,
                  })
                  if (reportApprovalOutcome(res, t)) toast.success(t('dashboard.approvedSuccess'))
                  refreshAfterAction(pickerRec.id, res?.status, true)
                } catch (error) {
                  toast.error(
                    error instanceof ApiError ? error.message : t('dashboard.actionFailed'),
                  )
                  setActedIds((prev) => {
                    const next = new Set(prev)
                    next.delete(pickerRec.id)
                    return next
                  })
                }
              }}
              onCancel={() => setAlbumPickerRec(null)}
            />
          )
        })()}
    </div>
  )
}
