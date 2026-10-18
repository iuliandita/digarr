import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import type { MessageKey } from '@/core/i18n/messages/types'
import type { RejectionReason } from '@/core/recommendations/rejection-reasons'
import { AlbumPicker } from '../components/album-picker'
import { ApproveDialog } from '../components/approve-dialog'
import { CardStack } from '../components/card-stack'
import { ConfirmDialog } from '../components/confirm-dialog'
import { DiscoverTabs } from '../components/discover-tabs'
import {
  type Decade,
  DiscoverMoreMenu,
  FiltersPopover,
  type TasteOrdering,
  type ViewMode,
} from '../components/discover-toolbar'
import { Hint } from '../components/hint'
import { MonitoringOptions, type MonitorOption } from '../components/monitoring-options'
import { MoodPromptBar } from '../components/mood-prompt-bar'
import {
  type Recommendation,
  RecommendationCard,
  recommendationDisplayName,
} from '../components/recommendation-card'
import { RejectionPicker } from '../components/rejection-picker'
import { SwipeCard } from '../components/swipe-card'
import {
  canApproveArtistToTarget,
  resolveApprovalTargetOptions,
  resolveDialogLidarrTarget,
} from '../components/target-utils'
import { Button } from '../components/ui/button'
import { EmptyState as UiEmptyState } from '../components/ui/empty-state'
import { Notice } from '../components/ui/notice'
import { Skeleton } from '../components/ui/skeleton'
import { useHints } from '../hooks/use-hints'
import { useKeyboardShortcuts } from '../hooks/use-keyboard-shortcuts'
import { usePopularAlbumsAvailability } from '../hooks/use-popular-albums-availability'
import type { PreviewFailureReason } from '../hooks/use-preview'
import { usePullToRefresh } from '../hooks/use-pull-to-refresh'
import {
  ApiError,
  approveRecommendation,
  approveToTarget,
  bulkAction,
  deleteAlbumBlock,
  deleteArtistBlock,
  getAuthStatus,
  getFeedbackSummary,
  getRecommendations,
  getUserPreferences,
  getWarmStatuses,
  listTargets,
  rescanArtists,
  triggerPipeline,
  updateRecommendation,
} from '../lib/api'
import { reportApprovalOutcome } from '../lib/approval'
import { useI18n } from '../lib/i18n'
import { usePreviewContext } from '../lib/preview-context'

type FilterTab = 'all' | 'pending' | 'approved' | 'rejected'
type KindFilter = 'all' | 'artist' | 'album'

const PREVIEW_REASON_KEYS: Record<PreviewFailureReason, MessageKey> = {
  'missing-links': 'preview.reason.missing-links',
  'no-match': 'preview.reason.no-match',
  'no-audio': 'preview.reason.no-audio',
  'lookup-failed': 'preview.reason.lookup-failed',
  blocked: 'preview.reason.blocked',
  'playback-failed': 'preview.reason.playback-failed',
  'controller-unavailable': 'preview.reason.controller-unavailable',
}

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
  approved: 'added_to_lidarr,add_failed,approved,waiting',
  rejected: 'rejected',
}

// 'all' sends no kind param; artist/album scope the recommendations fetch.
const KIND_PARAM: Record<KindFilter, string | undefined> = {
  all: undefined,
  artist: 'artist',
  album: 'album',
}

const KIND_FILTERS: KindFilter[] = ['all', 'artist', 'album']

function initialKindFromParam(value: string | null): KindFilter {
  return value === 'artist' || value === 'album' ? value : 'all'
}

const PAGE_SIZE = 50
const UNDO_MESSAGE_KEYS = {
  approved: 'discover.undoApproved',
  rejected: 'discover.undoRejected',
  blocked: 'discover.undoBlocked',
} as const satisfies Record<string, MessageKey>
const CLEAR_ALL_BATCH_SIZE = 200

/** Surfaces why a "Popular albums" approval failed, falling back to a generic message. */
function approveErrorMessage(
  err: unknown,
  fallback: string,
  t: (key: MessageKey) => string,
): string {
  const code = err instanceof ApiError ? (err.data as { code?: string })?.code : undefined
  return code === 'no_source' || code === 'no_match' ? t('discover.popularAlbumsFailed') : fallback
}

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

function EmptyState({ filter, kind }: { filter: FilterTab; kind: KindFilter }) {
  const { t } = useI18n()
  if (kind === 'album') {
    return (
      <div className="py-16 text-center space-y-4">
        <div className="space-y-1">
          <p className="text-text text-sm font-medium">{t('discover.emptyAlbums')}</p>
          <p className="text-muted text-sm max-w-xl mx-auto">{t('discover.emptyAlbumsHelp')}</p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/discover/modes?mode=gap-fill"
            className="px-3 py-1.5 text-sm bg-accent text-accent-fg rounded-md hover:opacity-90 transition-opacity"
          >
            {t('discoveryMode.gap-fill.label')}
          </Link>
          <Link
            to="/discover/modes?mode=release-radar"
            className="px-3 py-1.5 text-sm text-accent-text border border-accent/40 rounded-md hover:bg-accent/10 transition-colors"
          >
            {t('discoveryMode.release-radar.label')}
          </Link>
          <Link
            to="/settings?tab=recommendations#net-new-album-discovery"
            className="px-3 py-1.5 text-sm text-accent-text border border-accent/40 rounded-md hover:bg-accent/10 transition-colors"
          >
            {t('settings.netNewAlbumDiscovery')}
          </Link>
        </div>
      </div>
    )
  }

  if (filter === 'all') {
    return (
      <div className="py-16 text-center space-y-3">
        <p className="text-muted text-sm">{t('discover.emptyAll')}</p>
        <div className="flex items-center justify-center gap-3">
          <Link
            to="/subscriptions"
            className="px-3 py-1.5 text-sm text-accent-text border border-accent/40 rounded-md hover:bg-accent/10 transition-colors"
          >
            {t('discover.importArtists')}
          </Link>
          <button
            type="button"
            onClick={() =>
              triggerPipeline()
                .then((res) =>
                  toast.success(
                    res.status === 'duplicate'
                      ? t('discover.scanAlreadyRunning')
                      : res.queued
                        ? t('discover.scanQueued').replace('{0}', String(res.position ?? 0))
                        : t('discover.scanStarted'),
                  ),
                )
                .catch((err) => {
                  const msg =
                    typeof err === 'object' && err !== null && 'message' in err
                      ? String(err.message)
                      : String(err)
                  toast.error(msg)
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
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    getFeedbackSummary()
      .then((r) => setGenreRates(r.summary))
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  if (!loaded) return null
  return (
    <div className="mb-4">
      {genreRates.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
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
      ) : (
        <p className="text-xs text-muted">{t('discover.notEnoughFeedback')}</p>
      )}
    </div>
  )
}

// Discover page

export function DiscoverPage() {
  const { isHintDismissed } = useHints()
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const preview = usePreviewContext()
  const popularAvailable = usePopularAlbumsAvailability()
  const { data: authStatus } = useQuery({ queryKey: ['auth-status'], queryFn: getAuthStatus })
  const isAdmin = authStatus?.isAdmin ?? false
  const [searchParams, setSearchParams] = useSearchParams()
  const [filter, setFilter] = useState<FilterTab>('pending')
  const [kindFilter, setKindFilter] = useState<KindFilter>(() =>
    initialKindFromParam(searchParams.get('kind')),
  )
  const [viewMode, setViewMode] = useState<ViewMode>(getStoredViewMode)
  const [tasteOrdering, setTasteOrdering] = useState<TasteOrdering>('score')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [approveThreshold, setApproveThreshold] = useState(70)
  const [actingIds, setActingIds] = useState<Set<number>>(new Set())
  const [page, setPage] = useState(0)
  const [bulkMode, setBulkMode] = useState(false)
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set())
  const [bulkActing, setBulkActing] = useState(false)
  const [bulkRejectPickerOpen, setBulkRejectPickerOpen] = useState(false)
  const [rejectTarget, setRejectTarget] = useState<{
    id: number
    prevStatus: string
    artistName: string
  } | null>(null)
  const [albumPickerRecId, setAlbumPickerRecId] = useState<number | null>(null)
  const [showClearAllConfirm, setShowClearAllConfirm] = useState(false)
  const [activeDecades, setActiveDecades] = useState<Set<Decade>>(new Set())
  const [insightsOpen, setInsightsOpen] = useState(false)
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
  const hasPrimaryGenres = Array.isArray(prefs.primaryGenres) && prefs.primaryGenres.length > 0
  const hasSecondaryGenres =
    Array.isArray(prefs.secondaryGenres) && prefs.secondaryGenres.length > 0

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

  // Keep the kind filter in sync with the URL so deep-links (e.g. the Albums
  // nav entry -> /discover?kind=album) preselect Albums even when the page is
  // already mounted.
  const kindParamFromUrl = searchParams.get('kind')
  useEffect(() => {
    setKindFilter(initialKindFromParam(kindParamFromUrl))
    setPage(0)
  }, [kindParamFromUrl])

  const decadesParam = activeDecades.size > 0 ? [...activeDecades].join(',') : undefined

  const filterParams: Record<string, string> = {
    sort: tasteOrdering === 'score' ? 'score_desc' : 'taste',
  }
  const statusParam = STATUS_PARAM[filter]
  const kindParam = KIND_PARAM[kindFilter]
  if (statusParam) filterParams.status = statusParam
  if (decadesParam) filterParams.decades = decadesParam
  if (kindParam) filterParams.kind = kindParam
  if (tasteOrdering === 'primary' || tasteOrdering === 'secondary') {
    filterParams.tasteTier = tasteOrdering
  }

  const filterKey = {
    filter,
    kind: kindFilter,
    tasteOrdering,
    decades: [...activeDecades].sort().join(','),
  }
  const isStack = viewMode === 'stack'

  const pagedQuery = useQuery({
    queryKey: ['recommendations', { ...filterKey, page }],
    queryFn: () =>
      getRecommendations({
        ...filterParams,
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      }),
    enabled: !isStack,
  })

  // The stack walks every page instead of one grid page (#882).
  const stackQuery = useInfiniteQuery({
    queryKey: ['recommendations', 'stack', filterKey],
    queryFn: ({ pageParam }) =>
      getRecommendations({
        ...filterParams,
        limit: String(PAGE_SIZE),
        offset: String(pageParam),
      }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0)
      return last.items.length > 0 && loaded < last.total ? loaded : undefined
    },
    enabled: isStack,
  })
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = stackQuery
  const loadMoreStack = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const stackItems = useMemo(() => {
    const seen = new Set<number>()
    const out: Recommendation[] = []
    for (const p of stackQuery.data?.pages ?? []) {
      for (const rec of p.items as Recommendation[]) {
        if (seen.has(rec.id)) continue
        seen.add(rec.id)
        out.push(rec)
      }
    }
    return out
  }, [stackQuery.data])

  const loading = isStack ? stackQuery.isLoading : pagedQuery.isLoading
  const loadError = isStack ? stackQuery.error : pagedQuery.error
  const items = isStack ? stackItems : ((pagedQuery.data?.items ?? []) as Recommendation[])
  const total = isStack
    ? (stackQuery.data?.pages.at(-1)?.total ?? 0)
    : (pagedQuery.data?.total ?? 0)
  const FILTER_LABELS: Record<FilterTab, string> = {
    all: t('discover.all'),
    pending: t('discover.pending'),
    approved: t('discover.approved'),
    rejected: t('discover.rejected'),
  }
  const KIND_LABELS: Record<KindFilter, string> = {
    all: t('discover.kind.all'),
    artist: t('discover.kind.artists'),
    album: t('discover.kind.albums'),
  }

  const VIEW_OPTIONS = [
    { mode: 'grid' as ViewMode, Icon: GridIcon, label: t('discover.viewGrid') },
    { mode: 'list' as ViewMode, Icon: ListIcon, label: t('discover.viewList') },
    { mode: 'stack' as ViewMode, Icon: StackIcon, label: t('discover.viewStack') },
  ]

  // Errors and filter-caused emptiness must not read as an exhausted queue.
  const emptyContent = loadError ? (
    <Notice
      tone="error"
      className="my-8"
      action={
        <Button size="sm" variant="outline" onClick={refetch}>
          {t('errorBoundary.retry')}
        </Button>
      }
    >
      {t('discover.loadFailed')}
    </Notice>
  ) : activeDecades.size > 0 ? (
    <UiEmptyState
      className="py-16"
      message={t('discover.emptyFiltered')}
      action={
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setActiveDecades(new Set())
            setPage(0)
          }}
        >
          {t('discover.clearFilters')}
        </Button>
      }
    />
  ) : (
    <EmptyState filter={filter} kind={kindFilter} />
  )

  // Warm status

  const mbids = (isStack ? [] : items)
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

  const feedbackForRecommendation = useCallback(
    (id: number) => {
      const rec = items.find((item) => item.id === id)
      return rec && preview.currentMbid === rec.artist.mbid ? preview.currentTrack : undefined
    },
    [items, preview.currentMbid, preview.currentTrack],
  )

  const handleApproveToTarget = useCallback(
    async (recId: number, targetId: string) => {
      // Show profile picker dialog for Lidarr targets
      const target = targets.find(
        (t) => `${t.type}-${t.id}` === targetId || String(t.id) === targetId,
      )
      if (target?.type === 'lidarr') {
        setApproveDialogState({ recId, monitorOption: 'none', targetId })
        return
      }

      setActingIds((prev) => new Set([...prev, recId]))
      try {
        const targetOptions = resolveApprovalTargetOptions(targets, targetId)
        await approveToTarget(recId, targetId, {
          ...targetOptions,
          feedbackTrack: feedbackForRecommendation(recId),
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
    [feedbackForRecommendation, refetch, t, targets],
  )

  // Undo toast

  type UndoAction = 'approved' | 'rejected' | 'blocked'
  type UndoEntry = {
    id: number
    prevStatus: string
    action: UndoAction
    name: string
    block?: { artistId: number } | { releaseGroupMbid: string }
  }
  const [undoEntry, setUndoEntry] = useState<UndoEntry | null>(null)
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const itemsRef = useRef<Recommendation[]>([])
  itemsRef.current = items

  const showUndo = useCallback(
    (id: number, prevStatus: string, action: UndoAction, blockCreated = false) => {
      const rec = itemsRef.current.find((item) => item.id === id)
      // Mirrors the server: album recs with a release group get an album block, else an artist block.
      // A block that existed before this reject is left in place on undo.
      const block =
        action !== 'blocked' || !blockCreated || !rec
          ? undefined
          : rec.kind === 'album' && rec.recommendedReleaseGroupId
            ? { releaseGroupMbid: rec.recommendedReleaseGroupId }
            : { artistId: rec.artist.id }
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
      setUndoEntry({
        id,
        prevStatus,
        action,
        name: rec ? recommendationDisplayName(rec, t) : '',
        block,
      })
      undoTimerRef.current = setTimeout(() => setUndoEntry(null), 5000)
    },
    [t],
  )

  const handleUndo = useCallback(async () => {
    if (!undoEntry) return
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    const entry = undoEntry
    setUndoEntry(null)
    try {
      await updateRecommendation(entry.id, { status: entry.prevStatus })
      if (entry.block && 'artistId' in entry.block) await deleteArtistBlock(entry.block.artistId)
      else if (entry.block) await deleteAlbumBlock(entry.block.releaseGroupMbid)
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
      getRecommendations({ status: 'added_to_lidarr,add_failed,approved,waiting', limit: '1' }),
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
        const res = await approveRecommendation(id, {
          monitorOption: option,
          selectedAlbumIds,
          feedbackTrack: feedbackForRecommendation(id),
        })
        if (reportApprovalOutcome(res, t)) showUndo(id, prevStatus, 'approved')
        refetch()
      } catch (err) {
        toast.error(approveErrorMessage(err, t('dashboard.approveFailed'), t))
      } finally {
        setActingIds((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }
    },
    [feedbackForRecommendation, hasLidarrTarget, refetch, showUndo, t],
  )

  const handleApprove = useCallback(
    async (id: number, prevStatus = 'pending') => {
      setActingIds((prev) => new Set([...prev, id]))
      const newStatus = filter === 'rejected' ? 'pending' : 'approved'
      try {
        let res: Awaited<ReturnType<typeof approveToTarget>>
        if (newStatus === 'approved' && standaloneSlskdTarget) {
          const targetId = `${standaloneSlskdTarget.type}-${standaloneSlskdTarget.id}`
          const targetOptions = resolveApprovalTargetOptions(targets, targetId)
          res = await approveToTarget(id, targetId, {
            ...targetOptions,
            feedbackTrack: feedbackForRecommendation(id),
          })
        } else {
          res = await updateRecommendation(id, {
            status: newStatus,
            ...(newStatus === 'approved' ? { feedbackTrack: feedbackForRecommendation(id) } : {}),
          })
        }
        if (filter !== 'rejected') {
          if (reportApprovalOutcome(res, t)) showUndo(id, prevStatus, 'approved')
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
    [feedbackForRecommendation, filter, refetch, showUndo, standaloneSlskdTarget, t, targets],
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
        const res = await updateRecommendation(id, body)
        showUndo(
          id,
          prevStatus,
          payload?.permanent ? 'blocked' : 'rejected',
          res?.blockCreated === true,
        )
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

  const requestReject = useCallback((id: number, prevStatus?: string) => {
    const rec = itemsRef.current.find((item) => item.id === id)
    setRejectTarget({
      id,
      prevStatus: prevStatus ?? rec?.status ?? 'pending',
      artistName: rec?.artist.name ?? '',
    })
  }, [])

  async function handleRetry(id: number) {
    setActingIds((prev) => new Set([...prev, id]))
    try {
      await updateRecommendation(id, {
        status: 'approved',
        feedbackTrack: feedbackForRecommendation(id),
      })
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

  // Re-approve only the targets that failed, one at a time so each attempt
  // merges over the prior result instead of racing it.
  async function handleRetryFailed(id: number, failedTargetIds: string[]) {
    if (failedTargetIds.length === 0) return
    setActingIds((prev) => new Set([...prev, id]))
    try {
      const stillFailed: string[] = []
      for (const targetId of failedTargetIds) {
        const res = await approveToTarget(id, targetId, {
          ...resolveApprovalTargetOptions(targets, targetId),
          feedbackTrack: feedbackForRecommendation(id),
        })
        stillFailed.push(...(res.targetSummary?.failures ?? []).map((f) => f.name))
      }
      if (stillFailed.length === 0) {
        toast.success(t('discover.retrySucceeded'))
      } else {
        toast.error(t('discover.approveAllFailed').replace('{0}', stillFailed.join(', ')))
      }
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

  function handleAudition() {
    const eligible = items.filter((r) => r.status === 'pending')
    if (eligible.length === 0) {
      toast.info(t('discover.nothingToAudition'))
      return
    }
    preview.audition.start(
      eligible.map((r) => ({
        mbid: r.artist.mbid,
        artistName: r.artist.name,
        streamingUrls: r.artist.streamingUrls,
      })),
    )
  }

  function handleRejectBelow() {
    const eligible = items.filter((r) => r.score * 100 < approveThreshold && r.status === 'pending')
    if (eligible.length === 0) {
      toast.info(`${t('discover.noPendingBelow')} ${approveThreshold}%`)
      return
    }
    setCheckedIds(new Set(eligible.map((r) => r.id)))
    setBulkRejectPickerOpen(true)
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

  function handleBulkReject() {
    if (checkedIds.size === 0) return
    // Open the shared picker to capture one reason + optional permanent block
    // for every selected recommendation.
    setBulkRejectPickerOpen(true)
  }

  async function commitBulkReject(payload: {
    reason: RejectionReason | null
    reasonText: string | null
    permanent: boolean
  }) {
    if (checkedIds.size === 0) return
    const count = checkedIds.size
    setBulkActing(true)
    try {
      await bulkAction([...checkedIds], 'reject', {
        reason: payload.reason,
        permanent: payload.permanent,
      })
      toast.success(`${t('discover.rejectedCount')} ${count}`)
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
        if (selectedIdRef.current != null) requestReject(selectedIdRef.current)
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
  const pendingBelowThreshold = items.filter(
    (r) => r.score * 100 < approveThreshold && r.status === 'pending',
  ).length
  const auditionEligible = items.filter((r) => r.status === 'pending').length

  return (
    <div
      className={`space-y-6 max-w-6xl mx-auto ${bulkMode ? 'pb-24' : 'pb-20'} md:pb-6`}
      {...pullHandlers}
    >
      <h1 className="sr-only">{t('discover.title')}</h1>
      <DiscoverTabs className="mx-6 mt-2" />
      {preview.audition.unavailable?.length > 0 && (
        <section
          className="rounded-lg border border-border bg-surface p-4 text-sm"
          aria-live="polite"
        >
          <div className="flex items-center justify-between gap-3">
            <p>
              {t('preview.unavailableSummary')
                .replace('{count}', String(preview.audition.unavailable.length))
                .replace('{total}', String(preview.audition.selectedCount))}
            </p>
            <button
              type="button"
              className="text-muted hover:text-text"
              onClick={preview.audition.dismissSummary}
            >
              {t('common.dismiss')}
            </button>
          </div>
          <ul className="mt-2 space-y-1 text-muted">
            {preview.audition.unavailable.map(({ item, reason }) => (
              <li key={item.mbid}>
                {item.artistName}: {t(PREVIEW_REASON_KEYS[reason])}
              </li>
            ))}
          </ul>
        </section>
      )}
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

      {/* Daily controls in one row; bulk and rare tools live in More */}
      {/* z-45: its menus must clear the bottom bars (z-40) but stay under dialogs (z-50) */}
      <div className="sticky top-0 z-45 bg-bg px-6 pt-4">
        <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
          <fieldset className="scroll-fade-x flex w-full min-w-0 items-center gap-1 overflow-x-auto rounded-surface border border-border bg-surface p-1 [scrollbar-width:none] md:w-auto">
            <legend className="sr-only">{t('discover.statusFilter')}</legend>
            {(Object.keys(FILTER_LABELS) as FilterTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                aria-pressed={filter === tab}
                onClick={() => {
                  setFilter(tab)
                  setExpandedId(null)
                  setSelectedId(null)
                  setPage(0)
                  setCheckedIds(new Set())
                }}
                className={`shrink-0 whitespace-nowrap px-3 py-1.5 rounded-control text-body font-medium transition-colors focus-ring ${
                  filter === tab ? 'bg-accent text-accent-fg' : 'text-muted hover:text-text'
                }`}
              >
                {FILTER_LABELS[tab]}
                {counts[tab] > 0 && (
                  <span
                    className={`ml-1.5 text-caption ${filter === tab ? 'opacity-70' : 'text-muted'}`}
                  >
                    {counts[tab]}
                  </span>
                )}
              </button>
            ))}
          </fieldset>

          <fieldset className="flex items-center gap-1 rounded-surface border border-border bg-surface p-1">
            <legend className="sr-only">{t('discover.kindFilter')}</legend>
            {KIND_FILTERS.map((kind) => (
              <button
                key={kind}
                type="button"
                aria-pressed={kindFilter === kind}
                onClick={() => {
                  setKindFilter(kind)
                  setExpandedId(null)
                  setSelectedId(null)
                  setPage(0)
                  setCheckedIds(new Set())
                  // Keep the URL in sync so the chip state survives navigation
                  // and matches the ?kind= param the URL->state effect reads.
                  setSearchParams(
                    (prev) => {
                      const next = new URLSearchParams(prev)
                      const param = KIND_PARAM[kind]
                      if (param) {
                        next.set('kind', param)
                      } else {
                        next.delete('kind')
                      }
                      return next
                    },
                    { replace: true },
                  )
                }}
                className={`whitespace-nowrap px-3 py-1.5 rounded-control text-body font-medium transition-colors focus-ring ${
                  kindFilter === kind ? 'bg-accent text-accent-fg' : 'text-muted hover:text-text'
                }`}
              >
                {KIND_LABELS[kind]}
              </button>
            ))}
          </fieldset>

          <div className="ml-auto flex items-center gap-2">
            <fieldset className="hidden items-center gap-0.5 rounded-surface border border-border bg-surface p-1 md:flex">
              <legend className="sr-only">{t('discover.viewLabel')}</legend>
              {VIEW_OPTIONS.map(({ mode, Icon, label }) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => handleSetViewMode(mode)}
                  aria-label={label}
                  aria-pressed={viewMode === mode}
                  title={label}
                  className={`p-1.5 rounded-control transition-colors focus-ring ${
                    viewMode === mode ? 'bg-accent text-accent-fg' : 'text-muted hover:text-text'
                  }`}
                >
                  <Icon />
                </button>
              ))}
            </fieldset>
            <FiltersPopover
              ordering={tasteOrdering}
              onOrderingChange={(ordering) => {
                setTasteOrdering(ordering)
                setPage(0)
                setSelectedId(null)
              }}
              hasPrimaryGenres={hasPrimaryGenres}
              hasSecondaryGenres={hasSecondaryGenres}
              decades={activeDecades}
              onToggleDecade={(decade) => {
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
              onClearDecades={() => {
                setActiveDecades(new Set())
                setPage(0)
              }}
            />
            <DiscoverMoreMenu
              viewMode={viewMode}
              viewOptions={VIEW_OPTIONS}
              onViewModeChange={handleSetViewMode}
              bulk={
                viewMode === 'stack'
                  ? undefined
                  : {
                      threshold: approveThreshold,
                      onThresholdChange: setApproveThreshold,
                      aboveCount: pendingAboveThreshold,
                      belowCount: pendingBelowThreshold,
                      auditionCount: auditionEligible,
                      onApproveAbove: handleApproveAbove,
                      onRejectBelow: handleRejectBelow,
                      onAudition: handleAudition,
                      bulkMode,
                      onToggleBulkMode: handleToggleBulkMode,
                    }
              }
              exportStatus={statusParam}
              onRefresh={
                isAdmin
                  ? () => {
                      toast.promise(rescanArtists(), {
                        loading: t('discover.refreshingArtistData'),
                        success: (r) =>
                          t('discover.rescanComplete')
                            .replace('{0}', String(r.updated))
                            .replace('{1}', String(r.attempted))
                            .replace('{2}', String(r.failed)),
                        error: t('discover.rescanFailed'),
                      })
                      setTimeout(refetch, 3000)
                    }
                  : undefined
              }
              onClearAll={filter === 'pending' ? () => setShowClearAllConfirm(true) : undefined}
              insightsOpen={insightsOpen}
              onToggleInsights={() => setInsightsOpen((v) => !v)}
            />
          </div>
        </div>
      </div>

      {/* Content area */}
      <div className="px-6">
        <MoodPromptBar existingArtistNames={existingArtistNames} onQueued={refetch} />

        <Hint id="mood-bar-intro" type="inline" className="mb-2">
          {t('discover.moodTip')}
        </Hint>

        {!bulkMode && viewMode !== 'stack' && items.length > 0 && (
          <>
            <p className="text-xs text-muted sm:hidden mb-4">{t('discover.swipeHint')}</p>
            {isHintDismissed('mood-bar-intro') && (
              <div className="hidden sm:block mb-4">
                <Hint id="discover-cards-tip" type="inline">
                  {t('discover.cardsTip')}
                </Hint>
              </div>
            )}
          </>
        )}

        {insightsOpen && <FeedbackInsights />}

        {/* Stack view */}
        {viewMode === 'stack' &&
          (loading ? (
            <div className="flex justify-center py-16">
              <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
          ) : items.length === 0 ? (
            emptyContent
          ) : (
            <CardStack
              recommendations={items}
              totalCount={total}
              resetKey={JSON.stringify(filterKey)}
              onNearEnd={loadMoreStack}
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
            emptyContent
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
                        swipeEnabled ? () => requestReject(rec.id, rec.status) : undefined
                      }
                    >
                      <RecommendationCard
                        recommendation={rec}
                        onApprove={isActing ? () => {} : handleApprove}
                        onReject={isActing ? () => {} : requestReject}
                        onClick={bulkMode ? undefined : handleCardClick}
                        isSelected={!bulkMode && selectedId === rec.id}
                        expanded={!bulkMode && isExpanded}
                        onRetry={handleRetry}
                        onRetryFailed={handleRetryFailed}
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
                        layout="grid"
                        approveNode={
                          !isActing &&
                          !bulkMode &&
                          !hasMultipleTargets &&
                          !hasStandaloneSlskdTarget ? (
                            <MonitoringOptions
                              loading={isActing}
                              popularAvailable={popularAvailable}
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
            emptyContent
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
                    onSwipeLeft={swipeEnabled ? () => requestReject(rec.id, rec.status) : undefined}
                  >
                    <RecommendationCard
                      recommendation={rec}
                      onApprove={isActing ? () => {} : handleApprove}
                      onReject={isActing ? () => {} : requestReject}
                      onClick={bulkMode ? undefined : handleCardClick}
                      isSelected={!bulkMode && selectedId === rec.id}
                      expanded={!bulkMode && expandedId === rec.id}
                      onRetry={handleRetry}
                      onRetryFailed={handleRetryFailed}
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
                            popularAvailable={popularAvailable}
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
        <div className="fixed bottom-[calc(var(--bottom-stack)+0.75rem)] left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-4 py-2.5 bg-surface border border-border rounded-lg shadow-lg text-sm">
          <span className="text-muted tabular-nums">
            {t('albumPicker.selectedCount').replace('{0}', String(checkedIds.size))}
          </span>
          <button
            type="button"
            onClick={handleSelectAll}
            className="text-xs text-accent-text underline"
          >
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
            onClick={handleToggleBulkMode}
            className="text-xs text-muted hover:text-text"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={handleBulkApprove}
            disabled={checkedIds.size === 0 || bulkActing}
            className="px-3 py-1 bg-approve/20 text-approve border border-approve/40 rounded text-sm font-medium hover:bg-approve/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {t('recommendation.approve')}
            {checkedIds.size > 0 ? ` (${checkedIds.size})` : ''}
          </button>
          <button
            type="button"
            onClick={handleBulkReject}
            disabled={checkedIds.size === 0 || bulkActing}
            className="px-3 py-1 bg-reject/5 text-reject border border-reject/40 rounded text-sm font-medium hover:bg-reject/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {t('recommendation.reject')}
            {checkedIds.size > 0 ? ` (${checkedIds.size})` : ''}
          </button>
        </div>
      )}

      {/* Undo toast */}
      {undoEntry && (
        <div className="fixed bottom-[calc(var(--bottom-stack)+0.75rem)] left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-4 py-2.5 bg-surface border border-border rounded-lg shadow-lg text-sm text-text">
          <span role="status">
            {undoEntry.name
              ? t(UNDO_MESSAGE_KEYS[undoEntry.action]).replace('{name}', undoEntry.name)
              : t('discover.actionApplied')}
          </span>
          <button
            type="button"
            onClick={handleUndo}
            className="text-accent-text font-medium hover:underline"
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
            {t('discover.pageRange')
              .replace('{0}', String(page * PAGE_SIZE + 1))
              .replace('{1}', String(Math.min((page + 1) * PAGE_SIZE, total)))
              .replace('{2}', String(total))}
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

      {/* Per-artist Lidarr profile picker dialog */}
      {approveDialogState && (
        <ApproveDialog
          lidarrTargetId={resolveDialogLidarrTarget(targets, approveDialogState.targetId)?.id}
          monitorOption={approveDialogState.monitorOption}
          onCancel={() => setApproveDialogState(null)}
          onConfirm={async (overrides) => {
            const { recId, targetId } = approveDialogState
            setApproveDialogState(null)
            setActingIds((prev) => new Set([...prev, recId]))
            try {
              let res: Awaited<ReturnType<typeof approveToTarget>>
              if (targetId) {
                const targetOptions = resolveApprovalTargetOptions(targets, targetId)
                res = await approveToTarget(recId, targetId, {
                  ...overrides,
                  ...targetOptions,
                  feedbackTrack: feedbackForRecommendation(recId),
                })
              } else {
                const dialogTarget = resolveDialogLidarrTarget(targets)
                res = await approveRecommendation(recId, {
                  ...overrides,
                  feedbackTrack: feedbackForRecommendation(recId),
                  ...(dialogTarget ? { lidarrTargetId: `lidarr-${dialogTarget.id}` } : {}),
                })
              }
              if (reportApprovalOutcome(res, t)) toast.success(t('dashboard.addedToLidarr'))
              refetch()
            } catch (err) {
              toast.error(approveErrorMessage(err, t('dashboard.addToLidarrFailed'), t))
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
      <RejectionPicker
        open={rejectTarget != null}
        artistName={rejectTarget?.artistName}
        onClose={() => setRejectTarget(null)}
        onSubmit={async (payload) => {
          if (rejectTarget) await handleReject(rejectTarget.id, rejectTarget.prevStatus, payload)
        }}
      />
      <RejectionPicker
        open={bulkRejectPickerOpen}
        onClose={() => setBulkRejectPickerOpen(false)}
        onSubmit={async (payload) => {
          await commitBulkReject(payload)
        }}
      />
    </div>
  )
}
