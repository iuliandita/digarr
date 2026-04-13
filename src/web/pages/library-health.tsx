import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import { HealthCheckCard } from '../components/health-check-card'
import { Hint } from '../components/hint'
import { LibraryFirstSyncBanner } from '../components/library-first-sync-banner'
import { LibrarySourcesPanel } from '../components/library-sources-panel'
import { LibraryStatsDisplay } from '../components/library-stats'
import { Skeleton } from '../components/ui/skeleton'
import {
  fixHealthCheck,
  getLibraryHealth,
  getLibraryStats,
  getSettings,
  type HealthCheckResult,
  type LibraryStats,
  scanLibraryHealth,
} from '../lib/api'
import { formatRelativeTime } from '../lib/format-time'
import { useI18n } from '../lib/i18n'

// Checks where the fix is a Lidarr background task (refresh/search),
// not an immediate DB write. These need longer delay before rescan.
const DEFERRED_FIXES = new Set(['missing-metadata', 'genre-gaps', 'missing-albums'])

const RESCAN_DELAY_DEFERRED = 30_000
const RESCAN_DELAY_IMMEDIATE = 5_000

function ChecksSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="bg-surface border border-border rounded-lg p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1.5 flex-1">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-3 w-52" />
            </div>
            <Skeleton className="h-5 w-8 rounded-full shrink-0" />
          </div>
          <Skeleton className="h-20 w-full" />
        </div>
      ))}
    </div>
  )
}

function StatsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-surface border border-border rounded-lg p-4 space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-8 w-24" />
          </div>
        ))}
      </div>
      <Skeleton className="h-48 w-full" />
    </div>
  )
}

// LibraryHealthPage

export function LibraryHealthPage() {
  const { locale, t } = useI18n()
  const queryClient = useQueryClient()
  const [fixingIds, setFixingIds] = useState<Set<string>>(new Set())
  const rescanTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const healthQuery = useQuery({
    queryKey: ['library', 'health'],
    queryFn: getLibraryHealth,
    refetchInterval: (query) => (query.state.data?.scanning ? 3000 : false),
  })

  const statsQuery = useQuery({
    queryKey: ['library', 'stats'],
    queryFn: getLibraryStats,
  })

  const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: getSettings })

  const rescanMutation = useMutation({
    mutationFn: scanLibraryHealth,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['library', 'health'] }),
  })

  const scheduleRescan = useCallback(
    (delayMs: number) => {
      if (rescanTimer.current) clearTimeout(rescanTimer.current)
      rescanTimer.current = setTimeout(() => {
        rescanMutation.mutate()
        rescanTimer.current = null
      }, delayMs)
    },
    [rescanMutation],
  )

  const artistLabel = useCallback(
    (count: number) =>
      count === 1 ? t('libraryHealth.artistSingular') : t('libraryHealth.artistPlural'),
    [t],
  )

  const handleFix = useCallback(
    async (checkId: string) => {
      setFixingIds((prev) => new Set(prev).add(checkId))
      try {
        const data = await fixHealthCheck(checkId)
        const isDeferred = DEFERRED_FIXES.has(checkId)

        if (data.failed === 0) {
          if (isDeferred) {
            toast.success(
              `${t('libraryHealth.triggeredActionFor')} ${data.completed} ${artistLabel(data.completed)} -- ${t('libraryHealth.rescanningSoon')}`,
            )
          } else {
            toast.success(
              `${t('libraryHealth.updated')} ${data.completed} ${artistLabel(data.completed)}`,
            )
          }
        } else {
          toast.warning(
            `${t('libraryHealth.processed')}: ${data.completed} • ${t('common.failed')}: ${data.failed}/${data.total}`,
            {
              description: data.errors.slice(0, 3).join('; '),
            },
          )
        }

        queryClient.invalidateQueries({ queryKey: ['library', 'health'] })
        scheduleRescan(isDeferred ? RESCAN_DELAY_DEFERRED : RESCAN_DELAY_IMMEDIATE)
      } catch {
        toast.error(t('libraryHealth.fixFailed'))
      } finally {
        setFixingIds((prev) => {
          const next = new Set(prev)
          next.delete(checkId)
          return next
        })
      }
    },
    [artistLabel, queryClient, scheduleRescan, t],
  )

  const scanning = healthQuery.data?.scanning ?? false
  const checks: HealthCheckResult[] = healthQuery.data?.checks ?? []
  const lastCompletedAt = healthQuery.data?.lastCompletedAt ?? null
  const syncIntervalHours = healthQuery.data?.syncIntervalHours ?? 6
  const stats: LibraryStats | undefined = statsQuery.data
  const prefs = (settingsQuery.data?.preferences ?? {}) as Record<string, unknown>
  const lidarrBaseUrl =
    (prefs.lidarrPublicUrl as string) || (settingsQuery.data?.lidarrUrl as string) || null
  const pendingRescan = rescanTimer.current !== null

  return (
    <div className="p-6 space-y-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-bold text-text">{t('libraryHealth.title')}</h1>
      </div>

      <LibraryFirstSyncBanner />

      <Hint id="library-health-intro-tip" type="inline">
        {t('libraryHealth.introTip')}
      </Hint>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto]">
        <div className="rounded-lg border border-border bg-surface p-4 space-y-2">
          <div className="text-xs uppercase tracking-wide text-muted">
            {t('libraryHealth.snapshotTitle')}
          </div>
          <div className="text-sm text-text">
            {lastCompletedAt
              ? `${t('libraryHealth.lastSynced')} ${formatRelativeTime(locale, lastCompletedAt)}`
              : t('libraryHealth.neverSynced')}
          </div>
          <div className="text-xs text-muted">
            {t('libraryHealth.autoSyncEvery').replace('{0}', String(syncIntervalHours))}
          </div>
        </div>
        <button
          type="button"
          onClick={() => rescanMutation.mutate()}
          disabled={scanning || rescanMutation.isPending}
          className="flex items-center justify-center gap-2 px-3 py-1.5 bg-accent text-accent-fg rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          <RefreshCw size={14} className={scanning ? 'animate-spin' : undefined} />
          {scanning ? t('app.scanning') : t('libraryHealth.syncNow')}
        </button>
      </div>

      {/* Scanning indicator */}
      {scanning && (
        <div className="bg-accent/10 border border-accent/30 rounded-lg px-4 py-3 text-sm text-accent flex items-center gap-2">
          <RefreshCw size={14} className="animate-spin shrink-0" />
          {t('libraryHealth.scanningBanner')}
        </div>
      )}

      {/* Pending rescan indicator */}
      {pendingRescan && !scanning && (
        <div className="bg-surface border border-border rounded-lg px-4 py-2.5 text-xs text-muted flex items-center gap-2">
          <RefreshCw size={12} className="shrink-0" />
          {t('libraryHealth.pendingRescan')}
        </div>
      )}

      {/* Health checks */}
      <div className="space-y-3">
        {healthQuery.isLoading ? (
          <ChecksSkeleton />
        ) : checks.length === 0 && !scanning ? (
          <div className="bg-surface border border-border rounded-lg px-4 py-8 text-center text-muted text-sm">
            {t('libraryHealth.noChecks')}
          </div>
        ) : checks.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {checks.map((check) => (
              <HealthCheckCard
                key={check.id}
                check={check}
                onFix={handleFix}
                fixing={fixingIds.has(check.id)}
                lidarrBaseUrl={lidarrBaseUrl}
              />
            ))}
          </div>
        ) : null}
      </div>

      {/* Library sources */}
      <LibrarySourcesPanel />

      {/* Divider */}
      <hr className="border-border" />

      {/* Library stats */}
      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-text uppercase tracking-wide">
          {t('libraryHealth.statisticsTitle')}
        </h2>
        {statsQuery.isLoading ? (
          <StatsSkeleton />
        ) : stats ? (
          <LibraryStatsDisplay stats={stats} />
        ) : (
          <div className="bg-surface border border-border rounded-lg px-4 py-8 text-center text-muted text-sm">
            {t('libraryHealth.statisticsUnavailable')}
          </div>
        )}
      </div>
    </div>
  )
}
