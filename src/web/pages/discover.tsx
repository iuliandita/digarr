import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Filter as FilterIcon, MoreHorizontal, RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { errMsg } from '@/core/validation'
import { AlbumPicker } from '../components/album-picker'
import { ApproveDialog } from '../components/approve-dialog'
import { CardStack } from '../components/card-stack'
import { ConfirmDialog } from '../components/confirm-dialog'
import { Hint } from '../components/hint'
import { MonitoringOptions, type MonitorOption } from '../components/monitoring-options'
import { MoodPromptBar } from '../components/mood-prompt-bar'
import { type Recommendation, RecommendationCard } from '../components/recommendation-card'
import { SwipeCard } from '../components/swipe-card'
import { canApproveArtistToTarget, resolveApprovalTargetOptions } from '../components/target-utils'
import { Skeleton } from '../components/ui/skeleton'
import { useClickOutside } from '../hooks/use-click-outside'
import { useKeyboardShortcuts } from '../hooks/use-keyboard-shortcuts'
import { usePullToRefresh } from '../hooks/use-pull-to-refresh'
import {
  approveRecommendation,
  approveToTarget,
  bulkAction,
  exportRecommendations,
  getFeedbackSummary,
  getRecommendations,
  getUserPreferences,
  getWarmStatuses,
  listTargets,
  rescanArtists,
  triggerPipeline,
  updateRecommendation,
} from '../lib/api'
import { useI18n } from '../lib/i18n'

type FilterTab = 'all' | 'pending' | 'approved' | 'rejected'
type ViewMode = 'grid' | 'list' | 'stack'
type Decade = '60s' | '70s' | '80s' | '90s' | '00s' | '10s' | '20s+'

const DECADES: Decade[] = ['60s', '70s', '80s', '90s', '00s', '10s', '20s+']

const VIEW_MODE_KEY = 'digarr:discover-view'

function getStoredViewMode(): ViewMode {
  try {
    const v = localStorage.getItem(VIEW_MODE_KEY)
    if (v === 'grid' || v === 'list' || v === 'stack') return v
  } catch {
    // ignore
  }
  return 'grid'
}

const STATUS_PARAM: Record<FilterTab, string | undefined> = {
  all: undefined,
  pending: 'pending',
  approved: 'added_to_lidarr,add_failed,approved',
  rejected: 'rejected',
}

const APPROVE_THRESHOLD_OPTIONS = [50, 60, 70, 80, 90]

const PAGE_SIZE = 50
const CLEAR_ALL_BATCH_SIZE = 200

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div key={i} className="bg-surface border border-border rounded-lg p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <Skeleton className="h-6 w-36" />
            <Skeleton className="h-5 w-12 rounded" />
          </div>
          <div className="flex gap-1">
            <Skeleton className="h-4 w-14 rounded-full" />
            <Skeleton className="h-4 w-16 rounded-full" />
          </div>
          <div className="flex gap-1.5">
            <Skeleton className="h-5 w-8 rounded" />
            <Skeleton className="h-5 w-8 rounded" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-7 w-16 rounded" />
            <Skeleton className="h-7 w-16 rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}

function EmptyState({ filter }: { filter: FilterTab }) {
  const { t } = useI18n()
  if (filter === 'all') {
    return (
      <div className="py-16 text-center space-y-3">
        <p className="text-muted text-sm">{t('discover.emptyAll')}</p>
        <div className="flex items-center justify-center gap-3">
          <Link
            to="/subscriptions"
            className="px-3 py-1.5 text-sm text-accent border border-accent/40 rounded-md hover:bg-accent/10 transition-colors"
          >
            {t('discover.importArtists')}
          </Link>
          <button
            type="button"
            onClick={() =>
              triggerPipeline()
                .then(() => toast.success(t('discover.scanStarted')))
                .catch((err) => {
                  const msg =
                    typeof err === 'object' && err !== null && 'message' in err
                      ? String(err.message)
                      : String(err)
                  toast.error(msg.includes('409') ? t('discover.scanAlreadyRunning') : msg)
                })
            }
            className="px-3 py-1.5 text-sm bg-accent text-accent-fg rounded-md hover:opacity-90 transition-opacity"
          >
            {t('discover.runScan')}
          </button>
        </div>
      </div>
    )
  }

  if (filter === 'approved') {
    return (
      <div className="py-16 text-center">
        <p className="text-muted text-sm">{t('discover.emptyApproved')}</p>
      </div>
    )
  }

  const messages: Record<string, string> = {
    pending: t('discover.emptyPending'),
    rejected: t('discover.emptyRejected'),
  }
  return (
    <div className="py-16 text-center">
      <p className="text-muted text-sm">{messages[filter] ?? ''}</p>
    </div>
  )
}

function GridIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-4 h-4"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </svg>
  )
}

function ListIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-4 h-4"
      aria-hidden="true"
    >
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  )
}

function StackIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-4 h-4"
      aria-hidden="true"
    >
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
  )
}

function FeedbackInsights() {
  const { t } = useI18n()
  const [genreRates, setGenreRates] = useState<
    Array<{ genre: string; rate: number; total: number }>
  >([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (open && genreRates.length === 0) {
      getFeedbackSummary()
        .then((r) => setGenreRates(r.summary))
        .catch(() => {})
    }
  }, [open, genreRates.length])

  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="text-xs text-muted hover:text-text transition-colors"
      >
        {open ? t('discover.hideFeedbackInsights') : t('discover.showFeedbackInsights')}
      </button>
      {open && genreRates.length > 0 && (
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {genreRates.slice(0, 12).map((g) => (
            <div key={g.genre} className="bg-surface border border-border rounded px-2 py-1.5">
              <div className="text-xs font-medium text-text truncate">{g.genre}</div>
              <div className="flex items-center gap-1 mt-0.5">
                <div className="flex-1 h-1 bg-bg rounded overflow-hidden">
                  <div
                    className="h-full bg-approve rounded"
                    style={{ width: `${Math.round(g.rate * 100)}%` }}
                  />
                </div>
                <span className="text-micro text-muted tabular-nums">
                  {Math.round(g.rate * 100)}%
                </span>
              </div>
              <div className="text-micro text-muted mt-0.5">
                {g.total} {t('discover.rated')}
              </div>
            </div>
          ))}
        </div>
      )}
      {open && genreRates.length === 0 && (
        <p className="text-xs text-muted mt-2">{t('discover.notEnoughFeedback')}</p>
      )}
    </div>
  )
}

// Decade filter popover — replaces always-visible decade pill row

function DecadeFilterButton({
  active,
  onToggle,
  onClear,
}: {
  active: Set<Decade>
  onToggle: (d: Decade) => void
  onClear: () => void
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => setOpen(false), open)

  const count = active.size
  const label =
    count > 0 ? t('discover.filtersActive').replace('{0}', String(count)) : t('discover.filters')

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`flex items-center gap-1.5 px-3 py-1.5 border rounded text-sm font-medium transition-colors ${
          count > 0
            ? 'bg-accent/10 border-accent/40 text-accent'
            : 'bg-surface border-border text-muted hover:text-text'
        }`}
      >
        <FilterIcon size={14} aria-hidden="true" />
        {label}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 bg-surface border border-border rounded-lg shadow-lg p-3 min-w-[260px]">
          <div className="text-xs uppercase tracking-wide text-muted mb-2">
            {t('discover.decadesLabel')}
          </div>
          <div className="flex flex-wrap gap-1">
            {DECADES.map((decade) => (
              <button
                key={decade}
                type="button"
                onClick={() => onToggle(decade)}
                className={`px-2 py-1 rounded-full text-xs font-medium transition-colors ${
                  active.has(decade)
                    ? 'bg-accent text-accent-fg'
                    : 'bg-bg border border-border text-muted hover:text-text'
                }`}
              >
                {decade}
              </button>
            ))}
          </div>
          {count > 0 && (
            <button
              type="button"
              onClick={() => {
                onClear()
                setOpen(false)
              }}
              className="mt-3 text-xs text-muted hover:text-text transition-colors"
            >
              {t('common.clear')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// Overflow menu — Refresh / Export / Clear All

function MoreMenu({
  filter,
  onRefresh,
  onClearAll,
  showClearAll,
}: {
  filter?: string
  onRefresh: () => void
  onClearAll: () => void
  showClearAll: boolean
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [exporting, setExporting] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => setOpen(false), open)

  async function handleExport(format: 'json' | 'csv' | 'm3u') {
    setExporting(format)
    try {
      await exportRecommendations(format, filter ? { status: filter } : undefined)
      toast.success(`${format.toUpperCase()} ${t('discover.exported')}`)
    } catch {
      toast.error(t('discover.exportFailed'))
    } finally {
      setExporting(null)
      setOpen(false)
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t('discover.moreActions')}
        title={t('discover.moreActions')}
        className="p-1.5 bg-surface border border-border rounded text-muted hover:text-text transition-colors"
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-20 bg-surface border border-border rounded-lg shadow-lg py-1 min-w-[200px]"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onRefresh()
              setOpen(false)
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-text hover:bg-bg transition-colors"
          >
            <RefreshCw size={14} aria-hidden="true" />
            {t('discover.refreshData')}
          </button>
          <div className="my-1 border-t border-border" />
          {(['json', 'csv', 'm3u'] as const).map((fmt) => (
            <button
              key={fmt}
              type="button"
              role="menuitem"
              onClick={() => handleExport(fmt)}
              disabled={exporting === fmt}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-text hover:bg-bg transition-colors disabled:opacity-50"
            >
              <Download size={14} aria-hidden="true" />
              {exporting === fmt
                ? t('discover.exporting')
                : `${t('discover.export')} ${fmt.toUpperCase()}`}
            </button>
          ))}
          {showClearAll && (
            <>
              <div className="my-1 border-t border-border" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onClearAll()
                  setOpen(false)
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-reject hover:bg-reject/10 transition-colors"
              >
                <Trash2 size={14} aria-hidden="true" />
                {t('discover.clearAll')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// Discover page

export function DiscoverPage() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<FilterTab>('pending')
  const [viewMode, setViewMode] = useState<ViewMode>(getStoredViewMode)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [approveThreshold, setApproveThreshold] = useState(70)
  const [actingIds, setActingIds] = useState<Set<number>>(new Set())
  const [page, setPage] = useState(0)
  const [bulkMode, setBulkMode] = useState(false)
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set())
  const [bulkActing, setBulkActing] = useState(false)
  const [albumPickerRecId, setAlbumPickerRecId] = useState<number | null>(null)
  const [showClearAllConfirm, setShowClearAllConfirm] = useState(false)
  const [activeDecades, setActiveDecades] = useState<Set<Decade>>(new Set())
  const [approveDialogState, setApproveDialogState] = useState<{
    recId: number
    monitorOption: MonitorOption
    targetId?: string
  } | null>(null)

  const { data: prefsData } = useQuery({
    queryKey: ['user-preferences'],
    queryFn: getUserPreferences,
    staleTime: 60_000,
  })
  const prefs = prefsData ?? {}

  const refetch = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['recommendations'] })
  }, [queryClient])

  const {
    pullY,
    pullThreshold: PULL_THRESHOLD,
    handlers: pullHandlers,
  } = usePullToRefresh(() => {
    refetch()
    toast.info(t('common.refreshing'))
  })

  function handleSetViewMode(mode: ViewMode) {
    setViewMode(mode)
    try {
      localStorage.setItem(VIEW_MODE_KEY, mode)
    } catch {
      // ignore
    }
    // Stack mode exits bulk mode (incompatible)
    if (mode === 'stack' && bulkMode) {
      setBulkMode(false)
      setCheckedIds(new Set())
    }
  }

  const decadesParam = activeDecades.size > 0 ? [...activeDecades].join(',') : undefined

  const queryParams: Record<string, string> = {
    sort: 'score_desc',
    limit: String(PAGE_SIZE),
    offset: String(page * PAGE_SIZE),
  }
  const statusParam = STATUS_PARAM[filter]
  if (statusParam) queryParams.status = statusParam
  if (decadesParam) queryParams.decades = decadesParam

  const { data, isLoading: loading } = useQuery({
    queryKey: ['recommendations', { filter, page, decades: [...activeDecades].sort().join(',') }],
    queryFn: () => getRecommendations(queryParams),
  })

  const items = (data?.items ?? []) as Recommendation[]
  const total = data?.total ?? 0
  const FILTER_LABELS: Record<FilterTab, string> = {
    all: t('discover.all'),
    pending: t('discover.pending'),
    approved: t('discover.approved'),
    rejected: t('discover.rejected'),
  }

  // Warm status

  const mbids = items
    .map((r) => r.artist.mbid)
    .filter(Boolean)
    .join(',')

  const { data: warmData } = useQuery({
    queryKey: ['warm-status', mbids],
    queryFn: () => getWarmStatuses(mbids),
    enabled: !!mbids,
    refetchInterval: 5000,
    staleTime: 2000,
  })

  const warmStatuses = warmData?.statuses ?? {}

  const { data: targetsData } = useQuery({
    queryKey: ['targets'],
    queryFn: listTargets,
    staleTime: 60_000,
  })

  const targets = targetsData ?? []
  const approveTargets = targets.filter(
    (target) => target.enabled && target.owned && canApproveArtistToTarget(target.type),
  )
  const hasMultipleTargets = approveTargets.length > 1
  const hasLidarrTarget = approveTargets.some((target) => target.type === 'lidarr')
  const hasStandaloneSlskdTarget =
    approveTargets.length === 1 && approveTargets[0]?.type === 'slskd'
  const standaloneSlskdTarget = hasStandaloneSlskdTarget ? approveTargets[0] : undefined

  const existingArtistNames = useMemo(
    () => new Set(items.map((r) => r.artist.name.toLowerCase())),
    [items],
  )

  const handleApproveToTarget = useCallback(
    async (recId: number, targetId: string) => {
      // Show profile picker dialog for Lidarr targets
      const target = targets.find(
        (t) => `${t.type}-${t.id}` === targetId || String(t.id) === targetId,
      )
      if (target?.type === 'lidarr') {
        setApproveDialogState({ recId, monitorOption: 'all', targetId })
        return
      }

      setActingIds((prev) => new Set([...prev, recId]))
      try {
        const targetOptions = resolveApprovalTargetOptions(targets, targetId)
        await approveToTarget(recId, targetId, {
          ...targetOptions,
        })
        refetch()
        toast.success(t('dashboard.sentToTarget'))
      } catch {
        toast.error(t('dashboard.approveFailed'))
      } finally {
        setActingIds((prev) => {
          const next = new Set(prev)
          next.delete(recId)
          return next
        })
      }
    },
    [refetch, t, targets],
  )

  // Undo toast

  type UndoEntry = { id: number; prevStatus: string }
  const [undoEntry, setUndoEntry] = useState<UndoEntry | null>(null)
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showUndo = useCallback((entry: UndoEntry) => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    setUndoEntry(entry)
    undoTimerRef.current = setTimeout(() => setUndoEntry(null), 5000)
  }, [])

  const handleUndo = useCallback(async () => {
    if (!undoEntry) return
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    const entry = undoEntry
    setUndoEntry(null)
    try {
      await updateRecommendation(entry.id, { status: entry.prevStatus })
      toast.success(t('discover.undone'))
      refetch()
    } catch {
      toast.error(t('discover.undoFailed'))
    }
  }, [undoEntry, refetch, t])

  // Count per filter for tab badges - fetch all counts independently
  const { data: allCountData } = useQuery({
    queryKey: ['recommendations', 'count', 'all'],
    queryFn: () => getRecommendations({ limit: '1' }),
  })
  const { data: pendingCountData } = useQuery({
    queryKey: ['recommendations', 'count', 'pending'],
    queryFn: () => getRecommendations({ status: 'pending', limit: '1' }),
  })
  const { data: approvedCountData } = useQuery({
    queryKey: ['recommendations', 'count', 'approved'],
    queryFn: () =>
      getRecommendations({ status: 'added_to_lidarr,add_failed,approved', limit: '1' }),
  })
  const { data: rejectedCountData } = useQuery({
    queryKey: ['recommendations', 'count', 'rejected'],
    queryFn: () => getRecommendations({ status: 'rejected', limit: '1' }),
  })

  const counts: Record<FilterTab, number> = {
    all: allCountData?.total ?? 0,
    pending: pendingCountData?.total ?? 0,
    approved: approvedCountData?.total ?? 0,
    rejected: rejectedCountData?.total ?? 0,
  }

  const handleApproveWithOptions = useCallback(
    async (
      id: number,
      option: MonitorOption,
      selectedAlbumIds?: string[],
      prevStatus = 'pending',
    ) => {
      // Non-selected options: show per-artist profile picker dialog if Lidarr targets exist
      if (option !== 'selected' && hasLidarrTarget) {
        setApproveDialogState({ recId: id, monitorOption: option })
        return
      }
      // 'selected' flow - album picker already ran, call API directly
      setActingIds((prev) => new Set([...prev, id]))
      try {
        await approveRecommendation(id, {
          monitorOption: option,
          selectedAlbumIds,
        })
        showUndo({ id, prevStatus })
        refetch()
      } catch {
        toast.error(t('dashboard.approveFailed'))
      } finally {
        setActingIds((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }
    },
    [hasLidarrTarget, refetch, showUndo, t],
  )

  const handleApprove = useCallback(
    async (id: number, prevStatus = 'pending') => {
      setActingIds((prev) => new Set([...prev, id]))
      const newStatus = filter === 'rejected' ? 'pending' : 'approved'
      try {
        if (newStatus === 'approved' && standaloneSlskdTarget) {
          const targetId = `${standaloneSlskdTarget.type}-${standaloneSlskdTarget.id}`
          const targetOptions = resolveApprovalTargetOptions(targets, targetId)
          await approveToTarget(id, targetId, targetOptions)
        } else {
          await updateRecommendation(id, { status: newStatus })
        }
        if (filter !== 'rejected') {
          showUndo({ id, prevStatus })
        } else {
          toast.success(t('discover.restoredToPending'))
        }
        refetch()
      } catch {
        toast.error(
          filter === 'rejected' ? t('discover.restoreFailed') : t('dashboard.approveFailed'),
        )
      } finally {
        setActingIds((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }
    },
    [filter, refetch, showUndo, standaloneSlskdTarget, t, targets],
  )

  const handleReject = useCallback(
    async (
      id: number,
      prevStatus = 'pending',
      payload?: {
        reason?: string | null
        reasonText?: string | null
        permanent?: boolean
      },
    ) => {
      setActingIds((prev) => new Set([...prev, id]))
      try {
        const body: Record<string, unknown> = { status: 'rejected' }
        if (payload?.reason) body.reason = payload.reason
        if (payload?.reasonText) body.reasonText = payload.reasonText
        if (payload?.permanent) body.permanent = true
        await updateRecommendation(id, body)
        showUndo({ id, prevStatus })
        refetch()
      } catch {
        toast.error(t('discover.rejectFailed'))
      } finally {
        setActingIds((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }
    },
    [refetch, showUndo, t],
  )

  async function handleRetry(id: number) {
    setActingIds((prev) => new Set([...prev, id]))
    try {
      await updateRecommendation(id, { status: 'approved' })
      toast.success(t('discover.queuedForRetry'))
      refetch()
    } catch {
      toast.error(t('discover.retryFailed'))
    } finally {
      setActingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  async function handleApproveAbove() {
    const eligible = items.filter(
      (r) => r.score * 100 >= approveThreshold && r.status === 'pending',
    )
    if (eligible.length === 0) {
      toast.info(`${t('discover.noPendingAbove')} ${approveThreshold}%`)
      return
    }
    try {
      await bulkAction(
        eligible.map((r) => r.id),
        'approve',
      )
      toast.success(`${t('discover.approvedCount')} ${eligible.length}`)
      refetch()
    } catch {
      toast.error(t('discover.bulkApproveFailed'))
    }
  }

  async function handleClearAll() {
    try {
      let cleared = 0

      while (true) {
        const pending = await getRecommendations({
          status: 'pending',
          limit: String(CLEAR_ALL_BATCH_SIZE),
        })
        const ids = (pending.items as Array<{ id: number }>).map((r) => r.id)
        if (ids.length === 0) break

        const result = (await bulkAction(ids, 'reject')) as { updated?: number } | undefined
        const updated = typeof result?.updated === 'number' ? result.updated : ids.length
        cleared += updated
        if (updated === 0 || ids.length < CLEAR_ALL_BATCH_SIZE) break
      }

      if (cleared === 0) {
        toast.info(t('discover.noPendingToClear'))
        return
      }
      toast.success(`${t('discover.clearedCount')} ${cleared}`)
      refetch()
    } catch {
      toast.error(t('discover.clearFailed'))
    }
  }

  function handleToggleBulkMode() {
    setBulkMode((prev) => {
      if (prev) setCheckedIds(new Set())
      return !prev
    })
  }

  function handleToggleSelect(id: number) {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function handleSelectAll() {
    setCheckedIds(new Set(items.map((r) => r.id)))
  }

  function handleDeselectAll() {
    setCheckedIds(new Set())
  }

  async function handleBulkApprove() {
    if (checkedIds.size === 0) return
    setBulkActing(true)
    try {
      await bulkAction([...checkedIds], 'approve')
      toast.success(`${t('discover.approvedCount')} ${checkedIds.size}`)
      setCheckedIds(new Set())
      refetch()
    } catch {
      toast.error(t('discover.bulkApproveFailed'))
    } finally {
      setBulkActing(false)
    }
  }

  async function handleBulkReject() {
    if (checkedIds.size === 0) return
    setBulkActing(true)
    try {
      await bulkAction([...checkedIds], 'reject')
      toast.success(`${t('discover.rejectedCount')} ${checkedIds.size}`)
      setCheckedIds(new Set())
      refetch()
    } catch {
      toast.error(t('discover.bulkRejectFailed'))
    } finally {
      setBulkActing(false)
    }
  }

  const handleCardClick = useCallback(
    (id: number) => {
      if (expandedId === id) {
        setExpandedId(null)
      } else {
        setExpandedId(id)
        setSelectedId(id)
      }
    },
    [expandedId],
  )

  const itemsRef = useRef(items)
  itemsRef.current = items

  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId

  useKeyboardShortcuts(
    {
      j: () => {
        const current = itemsRef.current
        if (current.length === 0) return
        const currentIndex =
          selectedIdRef.current != null
            ? current.findIndex((r) => r.id === selectedIdRef.current)
            : -1
        const nextIndex = currentIndex < current.length - 1 ? currentIndex + 1 : 0
        const nextItem = current[nextIndex]
        if (nextItem) setSelectedId(nextItem.id)
      },
      k: () => {
        const current = itemsRef.current
        if (current.length === 0) return
        const currentIndex =
          selectedIdRef.current != null
            ? current.findIndex((r) => r.id === selectedIdRef.current)
            : -1
        const prevIndex = currentIndex > 0 ? currentIndex - 1 : current.length - 1
        const prevItem = current[prevIndex]
        if (prevItem) setSelectedId(prevItem.id)
      },
      a: () => {
        if (selectedIdRef.current != null) handleApprove(selectedIdRef.current)
      },
      r: () => {
        if (selectedIdRef.current != null) handleReject(selectedIdRef.current)
      },
      d: () => {
        if (selectedIdRef.current != null) handleCardClick(selectedIdRef.current)
      },
      Enter: () => {
        if (selectedIdRef.current != null) handleCardClick(selectedIdRef.current)
      },
    },
    viewMode !== 'stack',
  )

  const pendingAboveThreshold = items.filter(
    (r) => r.score * 100 >= approveThreshold && r.status === 'pending',
  ).length

  return (
    <div
      className={`space-y-6 max-w-6xl mx-auto${bulkMode ? ' pb-24' : ' pb-6'} md:pb-6`}
      {...pullHandlers}
    >
      <h1 className="sr-only">{t('discover.title')}</h1>
      {/* Pull-to-refresh indicator */}
      {pullY > 0 && (
        <div
          className="flex items-center justify-center text-xs text-muted transition-all"
          style={{ height: `${Math.min(pullY, PULL_THRESHOLD + 20)}px` }}
          aria-hidden="true"
        >
          {pullY >= PULL_THRESHOLD ? t('common.releaseToRefresh') : t('common.pullToRefresh')}
        </div>
      )}

      {/* Sticky filter + toolbar bar */}
      <div className="sticky top-0 z-10 bg-bg border-b border-border px-6 pt-4 pb-3 -mx-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Filter tabs */}
          <div className="flex items-center gap-1 bg-surface border border-border rounded-lg p-1">
            {(Object.keys(FILTER_LABELS) as FilterTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => {
                  setFilter(tab)
                  setExpandedId(null)
                  setSelectedId(null)
                  setPage(0)
                  setCheckedIds(new Set())
                }}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  filter === tab ? 'bg-accent text-accent-fg' : 'text-muted hover:text-text'
                }`}
              >
                {FILTER_LABELS[tab]}
                {tab !== 'all' && counts[tab] > 0 && (
                  <span
                    className={`ml-1.5 text-xs ${filter === tab ? 'opacity-70' : 'text-muted'}`}
                  >
                    {counts[tab]}
                  </span>
                )}
                {tab === 'all' && counts.all > 0 && (
                  <span
                    className={`ml-1.5 text-xs ${filter === tab ? 'opacity-70' : 'text-muted'}`}
                  >
                    {counts.all}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* View mode switcher */}
            <div className="flex items-center gap-0.5 bg-surface border border-border rounded-lg p-1">
              {(
                [
                  { mode: 'grid' as ViewMode, Icon: GridIcon, label: t('discover.viewGrid') },
                  { mode: 'list' as ViewMode, Icon: ListIcon, label: t('discover.viewList') },
                  { mode: 'stack' as ViewMode, Icon: StackIcon, label: t('discover.viewStack') },
                ] as const
              ).map(({ mode, Icon, label }) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => handleSetViewMode(mode)}
                  aria-label={label}
                  title={label}
                  className={`p-1.5 rounded transition-colors ${
                    viewMode === mode ? 'bg-accent text-accent-fg' : 'text-muted hover:text-text'
                  }`}
                >
                  <Icon />
                </button>
              ))}
            </div>

            {/* Approve All Above + Select - hidden in stack mode */}
            {viewMode !== 'stack' && (
              <>
                <select
                  value={approveThreshold}
                  onChange={(e) => setApproveThreshold(Number(e.target.value))}
                  className="bg-surface border border-border rounded text-sm text-text px-2 py-1.5"
                  aria-label={t('discover.thresholdPercentage')}
                >
                  {APPROVE_THRESHOLD_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}%
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleApproveAbove}
                  disabled={pendingAboveThreshold === 0}
                  className="px-3 py-1.5 bg-approve/20 text-approve border border-approve/40 rounded text-sm font-medium hover:bg-approve/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {t('discover.approveAllAbove')}
                  {pendingAboveThreshold > 0 && (
                    <span className="ml-1.5 text-xs opacity-70">({pendingAboveThreshold})</span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleToggleBulkMode}
                  className={`px-3 py-1.5 border rounded text-sm font-medium transition-colors ${
                    bulkMode
                      ? 'bg-accent text-accent-fg border-accent'
                      : 'bg-surface border-border text-muted hover:text-text'
                  }`}
                >
                  {bulkMode ? t('common.cancel') : t('discover.select')}
                </button>
                <DecadeFilterButton
                  active={activeDecades}
                  onToggle={(decade) => {
                    setActiveDecades((prev) => {
                      const next = new Set(prev)
                      if (next.has(decade)) {
                        next.delete(decade)
                      } else {
                        next.add(decade)
                      }
                      return next
                    })
                    setPage(0)
                  }}
                  onClear={() => {
                    setActiveDecades(new Set())
                    setPage(0)
                  }}
                />
                <MoreMenu
                  filter={statusParam}
                  onRefresh={() => {
                    toast.promise(rescanArtists(), {
                      loading: t('discover.refreshingArtistData'),
                      success: (r) =>
                        `${t('discover.updatedArtists')} ${r.updated} ${t('discover.of')} ${r.total}`,
                      error: t('discover.rescanFailed'),
                    })
                    setTimeout(refetch, 3000)
                  }}
                  onClearAll={() => setShowClearAllConfirm(true)}
                  showClearAll={filter === 'pending'}
                />
              </>
            )}
          </div>
        </div>
      </div>

      {/* Content area */}
      <div className="px-6">
        {/* Keyboard hint (hidden on small screens, swipe hint shown instead) */}
        {!bulkMode && viewMode !== 'stack' && (
          <>
            <p className="text-xs text-muted hidden sm:block mb-4">
              {t('discover.shortcutsLabel')}{' '}
              <kbd className="px-1 bg-surface border border-border rounded">j/k</kbd>{' '}
              {t('discover.navigate')}{' '}
              <kbd className="px-1 bg-surface border border-border rounded">a</kbd>{' '}
              {t('discover.shortcutApprove')}{' '}
              <kbd className="px-1 bg-surface border border-border rounded">r</kbd>{' '}
              {t('discover.shortcutReject')}{' '}
              <kbd className="px-1 bg-surface border border-border rounded">d</kbd>{' '}
              {t('discover.shortcutExpand')}{' '}
              <kbd className="px-1 bg-surface border border-border rounded">?</kbd>{' '}
              {t('discover.shortcuts')}
            </p>
            <p className="text-xs text-muted sm:hidden mb-4">{t('discover.swipeHint')}</p>
          </>
        )}

        <MoodPromptBar existingArtistNames={existingArtistNames} onQueued={refetch} />

        <Hint id="mood-bar-intro" type="inline" className="mb-2">
          {t('discover.moodTip')}
        </Hint>

        <FeedbackInsights />

        {/* Stack view */}
        {viewMode === 'stack' &&
          (loading ? (
            <div className="flex justify-center py-16">
              <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <CardStack
              recommendations={items}
              onApprove={handleApprove}
              onReject={handleReject}
              onDetail={(id) => {
                setExpandedId(expandedId === id ? null : id)
                setSelectedId(id)
                handleSetViewMode('grid')
              }}
            />
          ))}

        {/* Grid view */}
        {viewMode === 'grid' &&
          (loading ? (
            <SkeletonGrid />
          ) : items.length === 0 ? (
            <EmptyState filter={filter} />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {items.map((rec) => {
                const isExpanded = expandedId === rec.id
                const isActing = actingIds.has(rec.id)
                const isPending = rec.status === 'pending'
                const swipeEnabled = !bulkMode && isPending && !isActing
                return (
                  <div
                    key={rec.id}
                    className={isExpanded ? 'col-span-1 md:col-span-2 lg:col-span-3' : ''}
                  >
                    <SwipeCard
                      enabled={swipeEnabled}
                      onSwipeRight={
                        swipeEnabled ? () => handleApprove(rec.id, rec.status) : undefined
                      }
                      onSwipeLeft={
                        swipeEnabled ? () => handleReject(rec.id, rec.status) : undefined
                      }
                    >
                      <RecommendationCard
                        recommendation={rec}
                        onApprove={isActing ? () => {} : handleApprove}
                        onReject={isActing ? () => {} : handleReject}
                        onClick={bulkMode ? undefined : handleCardClick}
                        isSelected={!bulkMode && selectedId === rec.id}
                        expanded={!bulkMode && isExpanded}
                        onRetry={handleRetry}
                        bulkMode={bulkMode}
                        isChecked={checkedIds.has(rec.id)}
                        onToggleSelect={handleToggleSelect}
                        warmStatus={
                          warmStatuses[rec.artist.mbid] as
                            | 'warm'
                            | 'warming'
                            | 'unknown'
                            | undefined
                        }
                        targets={approveTargets.length > 0 ? approveTargets : undefined}
                        onApproveToTarget={
                          approveTargets.length > 0 ? handleApproveToTarget : undefined
                        }
                        approveNode={
                          !isActing &&
                          !bulkMode &&
                          !hasMultipleTargets &&
                          !hasStandaloneSlskdTarget ? (
                            <MonitoringOptions
                              loading={isActing}
                              onApprove={(option) =>
                                handleApproveWithOptions(rec.id, option, undefined, rec.status)
                              }
                              onOpenAlbumPicker={() => setAlbumPickerRecId(rec.id)}
                            />
                          ) : undefined
                        }
                      />
                    </SwipeCard>
                  </div>
                )
              })}
            </div>
          ))}

        {/* List view */}
        {viewMode === 'list' &&
          (loading ? (
            <SkeletonGrid />
          ) : items.length === 0 ? (
            <EmptyState filter={filter} />
          ) : (
            <div className="flex flex-col gap-3">
              {items.map((rec) => {
                const isActing = actingIds.has(rec.id)
                const isPending = rec.status === 'pending'
                const swipeEnabled = !bulkMode && isPending && !isActing
                return (
                  <SwipeCard
                    key={rec.id}
                    enabled={swipeEnabled}
                    onSwipeRight={
                      swipeEnabled ? () => handleApprove(rec.id, rec.status) : undefined
                    }
                    onSwipeLeft={swipeEnabled ? () => handleReject(rec.id, rec.status) : undefined}
                  >
                    <RecommendationCard
                      recommendation={rec}
                      onApprove={isActing ? () => {} : handleApprove}
                      onReject={isActing ? () => {} : handleReject}
                      onClick={bulkMode ? undefined : handleCardClick}
                      isSelected={!bulkMode && selectedId === rec.id}
                      expanded={!bulkMode && expandedId === rec.id}
                      onRetry={handleRetry}
                      bulkMode={bulkMode}
                      isChecked={checkedIds.has(rec.id)}
                      onToggleSelect={handleToggleSelect}
                      warmStatus={
                        warmStatuses[rec.artist.mbid] as 'warm' | 'warming' | 'unknown' | undefined
                      }
                      targets={approveTargets.length > 0 ? approveTargets : undefined}
                      onApproveToTarget={
                        approveTargets.length > 0 ? handleApproveToTarget : undefined
                      }
                      approveNode={
                        !isActing &&
                        !bulkMode &&
                        !hasMultipleTargets &&
                        !hasStandaloneSlskdTarget ? (
                          <MonitoringOptions
                            loading={isActing}
                            onApprove={(option) =>
                              handleApproveWithOptions(rec.id, option, undefined, rec.status)
                            }
                            onOpenAlbumPicker={() => setAlbumPickerRecId(rec.id)}
                          />
                        ) : undefined
                      }
                    />
                  </SwipeCard>
                )
              })}
            </div>
          ))}
      </div>

      {/* Bulk action toolbar */}
      {bulkMode && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 bg-surface border border-border rounded-lg shadow-lg text-sm">
          <span className="text-muted tabular-nums">{checkedIds.size} selected</span>
          <button type="button" onClick={handleSelectAll} className="text-xs text-accent underline">
            {t('common.all')}
          </button>
          <button
            type="button"
            onClick={handleDeselectAll}
            className="text-xs text-muted hover:text-text"
          >
            {t('common.none')}
          </button>
          <div className="w-px h-4 bg-border" />
          <button
            type="button"
            onClick={handleBulkApprove}
            disabled={checkedIds.size === 0 || bulkActing}
            className="px-3 py-1 bg-approve/20 text-approve border border-approve/40 rounded text-sm font-medium hover:bg-approve/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Approve{checkedIds.size > 0 ? ` (${checkedIds.size})` : ''}
          </button>
          <button
            type="button"
            onClick={handleBulkReject}
            disabled={checkedIds.size === 0 || bulkActing}
            className="px-3 py-1 bg-reject/20 text-reject border border-reject/40 rounded text-sm font-medium hover:bg-reject/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Reject{checkedIds.size > 0 ? ` (${checkedIds.size})` : ''}
          </button>
        </div>
      )}

      {/* Undo toast */}
      {undoEntry && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 bg-surface border border-border rounded-lg shadow-lg text-sm text-text">
          <span>{t('discover.actionApplied')}</span>
          <button
            type="button"
            onClick={handleUndo}
            className="text-accent font-medium hover:underline"
          >
            {t('discover.undo')}
          </button>
          <button
            type="button"
            aria-label={t('common.dismiss')}
            onClick={() => {
              if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
              setUndoEntry(null)
            }}
            className="text-muted hover:text-text ml-1"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-3.5 h-3.5"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      {/* Pagination */}
      {viewMode !== 'stack' && total > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-4 pt-4 px-6">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
            className="px-3 py-1.5 text-sm bg-surface border border-border rounded text-muted hover:text-text disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {t('common.previous')}
          </button>
          <span className="text-sm text-muted tabular-nums">
            {page * PAGE_SIZE + 1}--{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
          </span>
          <button
            type="button"
            disabled={(page + 1) * PAGE_SIZE >= total}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1.5 text-sm bg-surface border border-border rounded text-muted hover:text-text disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {t('common.next')}
          </button>
        </div>
      )}

      {/* FAB: Run Scan - mobile only, above bottom nav */}
      {!bulkMode && (
        <button
          type="button"
          onClick={() =>
            triggerPipeline()
              .then(() => toast.success(t('discover.scanStarted')))
              .catch((err) => {
                const msg = errMsg(err)
                toast.error(msg.includes('409') ? t('discover.scanAlreadyRunning') : msg)
              })
          }
          aria-label={t('app.runScan')}
          className="md:hidden fixed bottom-20 right-4 z-30 w-12 h-12 rounded-full bg-accent text-accent-fg shadow-lg flex items-center justify-center hover:opacity-90 transition-opacity"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-5 h-5"
            aria-hidden="true"
          >
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
        </button>
      )}

      {/* Per-artist Lidarr profile picker dialog */}
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
            setActingIds((prev) => new Set([...prev, recId]))
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
              refetch()
            } catch {
              toast.error(t('dashboard.addToLidarrFailed'))
            } finally {
              setActingIds((prev) => {
                const next = new Set(prev)
                next.delete(recId)
                return next
              })
            }
          }}
        />
      )}

      {/* Album picker modal */}
      {albumPickerRecId != null &&
        (() => {
          const pickerRec = items.find((r) => r.id === albumPickerRecId)
          if (!pickerRec) return null
          return (
            <AlbumPicker
              artistMbid={pickerRec.artist.mbid}
              artistName={pickerRec.artist.name}
              artistImageUrl={pickerRec.artist.imageUrl}
              suggestedAlbumId={pickerRec.recommendedReleaseGroupId}
              onConfirm={(selectedAlbumIds) => {
                setAlbumPickerRecId(null)
                handleApproveWithOptions(
                  albumPickerRecId,
                  'selected',
                  selectedAlbumIds,
                  pickerRec.status,
                )
              }}
              onCancel={() => setAlbumPickerRecId(null)}
            />
          )
        })()}
      {showClearAllConfirm && (
        <ConfirmDialog
          title={t('discover.rejectAllPending')}
          message={t('discover.rejectAllPendingMessage')}
          confirmLabel={t('discover.rejectAll')}
          onConfirm={() => {
            setShowClearAllConfirm(false)
            handleClearAll()
          }}
          onCancel={() => setShowClearAllConfirm(false)}
        />
      )}
    </div>
  )
}
