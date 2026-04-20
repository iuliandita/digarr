import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { ApproveDialog } from '../components/approve-dialog'
import { ArtistThumb } from '../components/artist-thumb'
import { Hint } from '../components/hint'
import type { MonitorOption } from '../components/monitoring-options'
import { PipelineProgress } from '../components/pipeline-progress'
import { RecentlyApproved } from '../components/recently-approved'
import { canApproveArtistToTarget, resolveApprovalTargetOptions } from '../components/target-utils'
import { type Recommendation, TodaysPick } from '../components/todays-pick'
import { Skeleton } from '../components/ui/skeleton'
import {
  type ActivityEntry,
  approveRecommendation,
  approveToTarget,
  getDashboardActivity,
  getDashboardTaste,
  getRecentTracks,
  getRecommendations,
  getSchedulerInfo,
  getSubscriptions,
  getTopArtists,
  getUserPreferences,
  type ListeningTopRange,
  listTargets,
  type RecentTrackEntry,
  rescanArtists,
  type SchedulerJob,
  type Subscription,
  type TasteGenre,
  type TopArtistEntry,
  triggerPipeline,
  updateRecommendation,
} from '../lib/api'
import { useI18n } from '../lib/i18n'

function formatRelativeTime(locale: string, dateStr: string | Date): string {
  const diffMs = new Date(dateStr).getTime() - Date.now()
  const diffMinutes = Math.round(diffMs / 60_000)
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })

  if (Math.abs(diffMinutes) < 1) return formatter.format(0, 'second')
  if (Math.abs(diffMinutes) < 60) return formatter.format(diffMinutes, 'minute')

  const diffHours = Math.round(diffMinutes / 60)
  if (Math.abs(diffHours) < 24) return formatter.format(diffHours, 'hour')

  return formatter.format(Math.round(diffHours / 24), 'day')
}

function SectionHeader({
  title,
  linkText,
  linkTo,
}: {
  title: string
  linkText?: string
  linkTo?: string
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-sm font-semibold text-text uppercase tracking-wide">{title}</h2>
      {linkText && linkTo && (
        <Link to={linkTo} className="text-xs text-accent underline">
          {linkText}
        </Link>
      )}
    </div>
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
        <SectionHeader
          title={t('dashboard.subscriptions')}
          linkText={t('dashboard.getStarted')}
          linkTo="/subscriptions"
        />
        <div className="bg-surface border border-border rounded-lg p-6 text-center space-y-2">
          <p className="text-sm text-muted">{t('dashboard.subscriptionsEmpty')}</p>
          <Link to="/subscriptions" className="text-xs text-accent underline inline-block">
            {t('dashboard.setUpAutomaticDiscovery')}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div>
      <SectionHeader
        title={t('dashboard.subscriptions')}
        linkText={t('dashboard.manage')}
        linkTo="/subscriptions"
      />
      <div className="bg-surface border border-border rounded-lg divide-y divide-border">
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

function ListeningHistory({
  data,
  range,
  page,
  pageSize,
  onRangeChange,
  onPageChange,
}: {
  data:
    | {
        tracks: TopArtistEntry[]
        total: number
        offset: number
        limit: number
      }
    | undefined
  range: ListeningTopRange
  page: number
  pageSize: number
  onRangeChange: (r: ListeningTopRange) => void
  onPageChange: (p: number) => void
}) {
  const { t } = useI18n()
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const hasPrev = page > 0
  const hasNext = page + 1 < totalPages
  return (
    <div>
      <div className="flex items-center justify-between mb-3 gap-2">
        <h2 className="text-sm font-semibold text-text uppercase tracking-wide">
          {t('dashboard.listeningHistory')}
        </h2>
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
      {!data || data.tracks.length === 0 ? (
        <div className="bg-surface border border-border rounded-lg p-6 text-center space-y-2">
          <p className="text-sm text-muted">{t('dashboard.connectListening')}</p>
          <Link to="/settings" className="text-xs text-accent underline inline-block">
            {t('dashboard.connectAccount')}
          </Link>
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-lg">
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
}: {
  data: { tracks: RecentTrackEntry[]; hasSource: boolean } | undefined
}) {
  const { t, locale } = useI18n()
  if (!data || !data.hasSource) return null
  return (
    <div>
      <h2 className="text-sm font-semibold text-text uppercase tracking-wide mb-3">
        {t('dashboard.recentPlays')}
      </h2>
      {data.tracks.length === 0 ? (
        <div className="bg-surface border border-border rounded-lg p-6 text-center">
          <p className="text-sm text-muted">{t('dashboard.recentPlaysEmpty')}</p>
        </div>
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
                <span className="text-xs text-accent shrink-0">{t('dashboard.nowPlaying')}</span>
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

function TasteProfile({ genres, loading }: { genres: TasteGenre[] | undefined; loading: boolean }) {
  const { t } = useI18n()
  return (
    <div>
      <SectionHeader title={t('dashboard.yourTaste')} />
      <div className="bg-surface border border-border rounded-lg p-4">
        {loading ? (
          <div className="space-y-3">
            {['t1', 't2', 't3', 't4', 't5'].map((k) => (
              <Skeleton key={k} className="h-4 w-full" />
            ))}
          </div>
        ) : !genres || genres.length === 0 ? (
          <p className="text-sm text-muted text-center py-4">{t('dashboard.tasteEmpty')}</p>
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
                    className="h-full bg-accent rounded-full transition-all"
                    style={{ width: `${g.percentage}%`, opacity: 1 - i * 0.15 }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ActivityFeed({
  entries,
  loading,
}: {
  entries: ActivityEntry[] | undefined
  loading: boolean
}) {
  const { locale, t } = useI18n()
  return (
    <div>
      <SectionHeader title={t('dashboard.recentActivity')} />
      <div className="bg-surface border border-border rounded-lg">
        {loading ? (
          <div className="p-4 space-y-3">
            {['a1', 'a2', 'a3', 'a4', 'a5'].map((k) => (
              <Skeleton key={k} className="h-4 w-full" />
            ))}
          </div>
        ) : !entries || entries.length === 0 ? (
          <p className="text-sm text-muted text-center py-6">{t('dashboard.activityEmpty')}</p>
        ) : (
          <div className="divide-y divide-border">
            {entries.map((entry) => (
              <div
                key={`${entry.type}-${entry.timestamp}-${entry.data.artistName ?? entry.data.subscriptionName ?? ''}`}
                className="flex items-center gap-3 px-4 py-2.5"
              >
                <span className="text-xs shrink-0">
                  {entry.type === 'approved'
                    ? '\u2713'
                    : entry.type === 'rejected'
                      ? '\u2717'
                      : entry.type === 'subscription_run'
                        ? '\u21BB'
                        : '\u25C9'}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-text truncate">
                    {entry.data.username && (
                      <span className="text-muted">{entry.data.username}: </span>
                    )}
                    {entry.type === 'approved' &&
                      `${t('dashboard.activityApproved')} ${entry.data.artistName}`}
                    {entry.type === 'rejected' &&
                      `${t('dashboard.activityRejected')} ${entry.data.artistName}`}
                    {entry.type === 'subscription_run' &&
                      `${entry.data.subscriptionName}: ${entry.data.artistsNew} ${t('dashboard.activityNew')}`}
                    {entry.type === 'scan_completed' &&
                      `${t('dashboard.activityScan')}: ${entry.data.discovered} ${t('dashboard.activityDiscovered')}`}
                  </p>
                </div>
                <span className="text-xs text-muted shrink-0">
                  {formatRelativeTime(locale, entry.timestamp)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function Dashboard() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
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
  const { data: approvedData, isLoading: approvedLoading } = useQuery({
    queryKey: ['dashboard-approved'],
    queryFn: () =>
      getRecommendations({
        status: 'added_to_lidarr,add_failed,approved',
        sort: 'acted_on_desc',
        limit: '9',
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
  const { data: topArtistsData } = useQuery({
    queryKey: ['dashboard-top-artists', listenRange, listenPage, LISTEN_PAGE_SIZE],
    queryFn: () => getTopArtists(listenRange, listenPage * LISTEN_PAGE_SIZE, LISTEN_PAGE_SIZE),
    staleTime: 30_000,
  })

  // Recent activity (latest scrobbles)
  const { data: recentTracksData } = useQuery({
    queryKey: ['dashboard-recent-tracks'],
    queryFn: () => getRecentTracks(5),
    staleTime: 30_000,
  })

  // Taste
  const { data: tasteData, isLoading: tasteLoading } = useQuery({
    queryKey: ['dashboard-taste'],
    queryFn: getDashboardTaste,
    staleTime: 30_000,
  })

  // Activity
  const { data: activityData, isLoading: activityLoading } = useQuery({
    queryKey: ['dashboard-activity'],
    queryFn: () => getDashboardActivity(5),
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

  // User preferences (for ApproveDialog defaults)
  const { data: prefsData } = useQuery({
    queryKey: ['user-preferences'],
    queryFn: getUserPreferences,
    staleTime: 60_000,
  })

  const prefs = (prefsData ?? {}) as Record<string, unknown>

  // ApproveDialog state (Lidarr profile picker)
  const [approveDialogState, setApproveDialogState] = useState<{
    recId: number
    monitorOption: MonitorOption
    targetId?: string
  } | null>(null)

  // Auto-rescan images for artists that are missing them (once per mount)
  const rescannedRef = useRef(false)
  useEffect(() => {
    if (rescannedRef.current) return
    const all = [
      ...((pickData?.items ?? []) as Recommendation[]),
      ...((approvedData?.items ?? []) as Recommendation[]),
    ]
    const missing = all.some((r) => !r.artist.imageUrl)
    if (missing && all.length > 0) {
      rescannedRef.current = true
      rescanArtists()
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ['dashboard-pick'] })
          queryClient.invalidateQueries({ queryKey: ['dashboard-approved'] })
        })
        .catch(() => {})
    }
  }, [pickData, approvedData, queryClient])

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

  async function handleAction(id: number, status: 'approved' | 'rejected') {
    setActedIds((prev) => new Set([...prev, id]))
    try {
      if (status === 'approved') {
        await approveRecommendation(id)
      } else {
        await updateRecommendation(id, { status })
      }
      toast.success(
        status === 'approved' ? t('dashboard.approvedSuccess') : t('dashboard.rejectedSuccess'),
      )
      queryClient.invalidateQueries({ queryKey: ['dashboard-pick'] })
      if (status === 'approved') {
        queryClient.invalidateQueries({ queryKey: ['dashboard-approved'] })
      }
    } catch {
      toast.error(t('dashboard.actionFailed'))
      setActedIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  async function handleApproveToTarget(recId: number, targetId: string) {
    const target = targets.find(
      (t) => `${t.type}-${t.id}` === targetId || String(t.id) === targetId,
    )
    if (target?.type === 'lidarr') {
      setApproveDialogState({ recId, monitorOption: 'all', targetId })
      return
    }

    setActedIds((prev) => new Set([...prev, recId]))
    try {
      const targetOptions = resolveApprovalTargetOptions(targets, targetId)
      await approveToTarget(recId, targetId, {
        ...targetOptions,
      })
      toast.success(t('dashboard.sentToTarget'))
      queryClient.invalidateQueries({ queryKey: ['dashboard-pick'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-approved'] })
    } catch {
      toast.error(t('dashboard.approveFailed'))
    } finally {
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

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-6xl mx-auto">
      {/* Pipeline progress (self-hides) */}
      <PipelineProgress
        onComplete={() => {
          queryClient.invalidateQueries({ queryKey: ['dashboard-pick'] })
          queryClient.invalidateQueries({ queryKey: ['dashboard-approved'] })
          queryClient.invalidateQueries({ queryKey: ['dashboard-activity'] })
        }}
        isFirstScan={
          (!pickData || pickData.items.length === 0) &&
          (!approvedData || approvedData.items.length === 0)
        }
      />

      {/* Today's Pick + Recently Approved */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <SectionHeader
            title={t('dashboard.todaysPick')}
            linkText={t('dashboard.discover')}
            linkTo="/discover"
          />
          <TodaysPick
            rec={currentPick}
            loading={pickLoading}
            onApprove={(id) => handleAction(id, 'approved')}
            onReject={(id) => handleAction(id, 'rejected')}
            onSkip={handleSkip}
            onRunScan={() => {
              triggerPipeline()
                .then(() => toast.success(t('discover.scanStarted')))
                .catch(() => toast.error(t('discover.scanStartFailed')))
            }}
            targets={approveTargets}
            onApproveToTarget={handleApproveToTarget}
          />
        </div>
        <div>
          <SectionHeader
            title={t('dashboard.recentlyApproved')}
            linkText={t('dashboard.viewAll')}
            linkTo="/discover"
          />
          <RecentlyApproved recs={approvedRecs} loading={approvedLoading} />
        </div>
      </div>

      <Hint id="dashboard-feedback-tip" type="spotlight">
        {t('dashboard.feedbackTip')}
      </Hint>

      {/* Subscription Pulse + Listening Activity */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-3">
          <SubscriptionPulse subs={subsData} scheduler={schedulerData} />
          <Hint id="dashboard-subscriptions-tip" type="inline">
            {t('dashboard.subscriptionsTip')}
          </Hint>
        </div>
        <div className="space-y-3">
          <ListeningHistory
            data={topArtistsData}
            range={listenRange}
            page={listenPage}
            pageSize={LISTEN_PAGE_SIZE}
            onRangeChange={(r) => {
              setListenRange(r)
              setListenPage(0)
            }}
            onPageChange={setListenPage}
          />
          <Hint id="dashboard-listening-tip" type="inline">
            {t('dashboard.listeningTip')}
          </Hint>
          <RecentActivity data={recentTracksData} />
        </div>
      </div>

      {/* Taste Profile + Activity Feed */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-3">
          <TasteProfile genres={tasteData} loading={tasteLoading} />
          <Hint id="dashboard-taste-tip" type="inline">
            {t('dashboard.tasteTip')}
          </Hint>
        </div>
        <ActivityFeed entries={activityData} loading={activityLoading} />
      </div>

      {/* Lidarr profile picker dialog (Today's Pick target approve) */}
      {approveDialogState && (
        <ApproveDialog
          defaults={{
            qualityProfileId: Number(prefs.qualityProfileId ?? 1),
            metadataProfileId: Number(prefs.metadataProfileId ?? 1),
            rootFolderId: Number(prefs.rootFolderId ?? 1),
          }}
          monitorOption={approveDialogState.monitorOption}
          onCancel={() => setApproveDialogState(null)}
          onConfirm={async (overrides) => {
            const { recId, targetId } = approveDialogState
            setApproveDialogState(null)
            setActedIds((prev) => new Set([...prev, recId]))
            try {
              if (targetId) {
                const targetOptions = resolveApprovalTargetOptions(targets, targetId)
                await approveToTarget(recId, targetId, {
                  ...overrides,
                  ...targetOptions,
                })
              } else {
                await approveRecommendation(recId, overrides)
              }
              toast.success(t('dashboard.addedToLidarr'))
              queryClient.invalidateQueries({ queryKey: ['dashboard-pick'] })
              queryClient.invalidateQueries({ queryKey: ['dashboard-approved'] })
            } catch {
              toast.error(t('dashboard.addToLidarrFailed'))
            } finally {
              setActedIds((prev) => {
                const next = new Set(prev)
                next.delete(recId)
                return next
              })
            }
          }}
        />
      )}
    </div>
  )
}
