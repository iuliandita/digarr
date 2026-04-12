import { selectBestSlskdCandidate } from '@/core/slskd/match-engine'
import { buildSlskdWorkKey } from '@/core/slskd/runner'

type SlskdPendingJobBase = { id: number }
type SlskdActiveJobState = 'pending' | 'searching' | 'queued' | 'downloading' | 'import_pending'
type SlskdTerminalJobState = 'completed' | 'failed' | 'cancelled'
type SlskdJobState = SlskdActiveJobState | SlskdTerminalJobState

type SlskdPendingJob = SlskdPendingJobBase & {
  id: number
  userId: number | null
  targetId: number
  recommendationId: number | null
  sourceType: string
  workKey: string
  artistMbid: string
  artistName: string
  releaseGroupMbid: string | null
  releaseTitle: string
  lidarrArtistId: number | null
  lidarrAlbumId: number | null
  state: string
  confidence: number | null
  slskdSearchId: string | null
  slskdQueueId: string | null
  slskdDownloadId: string | null
  selectedResult: Record<string, unknown> | null
  lastError: string | null
  attempts: number
  completedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

type SlskdTargetRow = {
  id: number
  userId: number | null
  enabled: boolean
  type: string
  name: string
  config: Record<string, unknown>
}

type LidarrWantedRelease = {
  id: number
  title: string
  foreignAlbumId?: string
  artistId?: number
  artist?: {
    id?: number
    artistName?: string
    foreignArtistId?: string
  }
  artistName?: string
  foreignArtistId?: string
}

type LidarrAlbum = {
  id: number
  title: string
  artistId: number
  foreignAlbumId: string
  monitored: boolean
  albumType: string
  statistics?: {
    trackCount: number
    trackFileCount: number
    percentOfTracks: number
  }
}

type SlskdSearchResult = {
  id: string
  filename: string
  username: string
  size: number
  bitrate?: number
  extension?: string
}

type SlskdDownload = {
  id: string
  username: string
  state: string
  directory?: string
  filename?: string
}

type SlskdClient = {
  createSearch: (queryText: string) => Promise<Record<string, unknown>>
  getSearchResults: (searchId: string) => Promise<SlskdSearchResult[]>
  enqueueResult: (searchId: string, resultId: string) => Promise<Record<string, unknown>>
  getDownloads: () => Promise<SlskdDownload[]>
}

type LidarrClient = {
  getWantedMissing?: () => Promise<LidarrWantedRelease[]>
  getAlbums?: (artistId: number) => Promise<LidarrAlbum[]>
}

type SlskdJobUpdate = {
  confidence?: number | null
  slskdSearchId?: string | null
  slskdQueueId?: string | null
  slskdDownloadId?: string | null
  selectedResult?: Record<string, unknown> | null
  lastError?: string | null
  attempts?: number
  completedAt?: Date | null
}

export type SlskdOrchestratorDeps<TJob extends SlskdPendingJobBase = SlskdPendingJobBase> = {
  listPendingJobs: (limit?: number) => Promise<TJob[]>
  processPendingJobs?: (jobs: TJob[]) => Promise<void>
  limit?: number
  logger?: Pick<Console, 'error' | 'info' | 'warn'>
  listTargets?: () => Promise<SlskdTargetRow[]>
  createSlskdClient?: (url: string, apiKey: string, skipTlsVerify?: boolean) => SlskdClient
  createLidarrClient?: (url: string, apiKey: string, skipTlsVerify?: boolean) => LidarrClient
  findActiveJobByWorkKey?: (workKey: string) => Promise<{ id: number } | null>
  createJob?: (input: {
    userId?: number | null
    targetId: number
    recommendationId?: number | null
    sourceType: string
    workKey: string
    artistMbid: string
    artistName: string
    releaseGroupMbid?: string | null
    releaseTitle: string
    lidarrArtistId?: number | null
    lidarrAlbumId?: number | null
  }) => Promise<{ id: number }>
  updateJobState?: (id: number, state: SlskdJobState, extra?: SlskdJobUpdate) => Promise<unknown>
  updateRecommendationAction?: (
    recommendationId: number,
    targetId: number,
    status: string,
    error?: string,
  ) => Promise<void>
  selectBestCandidate?: typeof selectBestSlskdCandidate
}

export type SlskdOrchestrator<_TJob extends SlskdPendingJobBase = SlskdPendingJobBase> = {
  readonly isSyncing: boolean
  triggerSync: () => Promise<void>
  warmup: () => Promise<void>
  getActiveJobs: (limit?: number) => Promise<_TJob[]>
}

function normalizeBoolean(value: unknown): boolean {
  return value === true
}

function normalizeInteger(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : null
}

function normalizeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function buildSearchQuery(job: SlskdPendingJob): string {
  return `${job.artistName} ${job.releaseTitle}`.trim()
}

function readEnqueueId(payload: Record<string, unknown>, fallback: string): string {
  const id =
    normalizeString(payload.id) ??
    normalizeString(payload.queueId) ??
    normalizeString(payload.downloadId)

  return id ?? fallback
}

function readDownloadId(payload: Record<string, unknown>, fallback: string): string {
  const id =
    normalizeString(payload.downloadId) ??
    normalizeString(payload.id) ??
    normalizeString(payload.queueId)

  return id ?? fallback
}

function normalizeDownloadState(state: string): 'queued' | 'downloading' | 'completed' | 'failed' {
  const normalized = state.trim().toLowerCase()

  if (
    normalized.includes('error') ||
    normalized.includes('fail') ||
    normalized.includes('abort') ||
    normalized.includes('cancel')
  ) {
    return 'failed'
  }

  if (
    normalized.includes('complete') ||
    normalized.includes('finished') ||
    normalized.includes('succeeded')
  ) {
    return 'completed'
  }

  if (
    normalized.includes('progress') ||
    normalized.includes('download') ||
    normalized.includes('transfer') ||
    normalized.includes('running')
  ) {
    return 'downloading'
  }

  return 'queued'
}

function getLinkedLidarrTarget(
  targets: SlskdTargetRow[],
  slskdTargetId: number,
): SlskdTargetRow | null {
  const slskdTarget = targets.find(
    (target) => target.id === slskdTargetId && target.type === 'slskd',
  )
  const linkedId = normalizeInteger(slskdTarget?.config?.lidarrTargetId)
  if (linkedId == null) return null

  return (
    targets.find(
      (target) =>
        target.id === linkedId && target.type === 'lidarr' && normalizeBoolean(target.enabled),
    ) ?? null
  )
}

function findMatchingDownload(
  job: SlskdPendingJob,
  downloads: SlskdDownload[],
): SlskdDownload | undefined {
  const selectedFilename = normalizeString(job.selectedResult?.filename)
  const selectedUsername = normalizeString(job.selectedResult?.username)

  return downloads.find((download) => {
    if (job.slskdDownloadId && download.id === job.slskdDownloadId) {
      return true
    }

    if (job.slskdQueueId && download.id === job.slskdQueueId) {
      return true
    }

    if (
      selectedFilename &&
      selectedUsername &&
      download.filename === selectedFilename &&
      download.username === selectedUsername
    ) {
      return true
    }

    return false
  })
}

function isAlbumImported(job: SlskdPendingJob, albums: LidarrAlbum[]): boolean {
  const album = albums.find((candidate) => {
    if (job.lidarrAlbumId != null && candidate.id === job.lidarrAlbumId) {
      return true
    }

    if (job.releaseGroupMbid && candidate.foreignAlbumId === job.releaseGroupMbid) {
      return true
    }

    return false
  })

  if (!album) return false

  const trackFileCount = album.statistics?.trackFileCount ?? 0
  const percentOfTracks = album.statistics?.percentOfTracks ?? 0
  return trackFileCount > 0 || percentOfTracks > 0
}

export function createSlskdOrchestrator<TJob extends SlskdPendingJobBase = SlskdPendingJobBase>(
  deps: SlskdOrchestratorDeps<TJob>,
): SlskdOrchestrator<TJob> {
  const logger = deps.logger ?? console
  const processPendingJobs = deps.processPendingJobs ?? (async () => {})
  const chooseCandidate = deps.selectBestCandidate ?? selectBestSlskdCandidate
  let activeRun: Promise<void> | null = null

  async function updateRecommendationAction(
    recommendationId: number | null,
    targetId: number,
    status: string,
    error?: string,
  ) {
    if (recommendationId == null || !deps.updateRecommendationAction) return
    if (error === undefined) {
      await deps.updateRecommendationAction(recommendationId, targetId, status)
      return
    }

    await deps.updateRecommendationAction(recommendationId, targetId, status, error)
  }

  async function intakeWantedReleases() {
    if (
      !deps.listTargets ||
      !deps.createLidarrClient ||
      !deps.findActiveJobByWorkKey ||
      !deps.createJob
    ) {
      return
    }

    const targets = await deps.listTargets()
    const slskdTargets = targets.filter(
      (target) => target.type === 'slskd' && normalizeBoolean(target.enabled),
    )

    for (const slskdTarget of slskdTargets) {
      const linkedLidarrTarget = getLinkedLidarrTarget(targets, slskdTarget.id)
      if (!linkedLidarrTarget) continue

      const lidarrUrl = normalizeString(linkedLidarrTarget.config.url)
      const lidarrApiKey = normalizeString(linkedLidarrTarget.config.apiKey)
      if (!lidarrUrl || !lidarrApiKey) continue

      const lidarr = deps.createLidarrClient(
        lidarrUrl,
        lidarrApiKey,
        normalizeBoolean(linkedLidarrTarget.config.skipTlsVerify),
      )
      const wanted = (await lidarr.getWantedMissing?.()) ?? []

      for (const release of wanted) {
        const artistMbid =
          normalizeString(release.artist?.foreignArtistId) ??
          normalizeString(release.foreignArtistId)
        const artistName =
          normalizeString(release.artist?.artistName) ?? normalizeString(release.artistName)
        const releaseGroupMbid = normalizeString(release.foreignAlbumId)

        if (!artistMbid || !artistName || !releaseGroupMbid) {
          continue
        }

        const workKey = buildSlskdWorkKey(slskdTarget.id, artistMbid, releaseGroupMbid)
        const existing = await deps.findActiveJobByWorkKey(workKey)
        if (existing) {
          continue
        }

        await deps.createJob({
          userId: slskdTarget.userId,
          targetId: slskdTarget.id,
          recommendationId: null,
          sourceType: 'lidarr_wanted',
          workKey,
          artistMbid,
          artistName,
          releaseGroupMbid,
          releaseTitle: release.title,
          lidarrArtistId: release.artistId ?? release.artist?.id ?? null,
          lidarrAlbumId: release.id,
        })
      }
    }
  }

  async function processSearchableJob(job: SlskdPendingJob, slskd: SlskdClient) {
    if (!deps.updateJobState) return

    let searchId = job.slskdSearchId
    if (!searchId) {
      const search = await slskd.createSearch(buildSearchQuery(job))
      searchId = normalizeString(search.id)
      if (!searchId) {
        throw new Error(`slskd search did not return an id for job ${job.id}`)
      }

      await deps.updateJobState(job.id, 'searching', {
        slskdSearchId: searchId,
        attempts: job.attempts + 1,
        lastError: null,
      })
    }

    const results = await slskd.getSearchResults(searchId)
    if (results.length === 0) {
      return
    }

    const selected = chooseCandidate(
      { artistName: job.artistName, releaseTitle: job.releaseTitle },
      results,
    )

    if (selected.decision !== 'auto_queue' || !selected.candidate) {
      await deps.updateJobState(job.id, 'failed', {
        confidence: selected.confidence,
        slskdSearchId: searchId,
        lastError: 'slskd search needs manual review',
      })
      await updateRecommendationAction(job.recommendationId, job.targetId, 'needs_review')
      return
    }

    const enqueue = await slskd.enqueueResult(searchId, selected.candidate.id)
    const slskdQueueId = readEnqueueId(enqueue, selected.candidate.id)
    const slskdDownloadId = readDownloadId(enqueue, slskdQueueId)

    await deps.updateJobState(job.id, 'queued', {
      confidence: selected.confidence,
      slskdSearchId: searchId,
      slskdQueueId,
      slskdDownloadId,
      selectedResult: selected.candidate,
      lastError: null,
    })
    await updateRecommendationAction(job.recommendationId, job.targetId, 'queued')
  }

  async function processTransferJob(
    job: SlskdPendingJob,
    slskd: SlskdClient,
    targets: SlskdTargetRow[] | null,
  ) {
    if (!deps.updateJobState) return

    const downloads = await slskd.getDownloads()
    const download = findMatchingDownload(job, downloads)

    if (!download) {
      if (job.lidarrArtistId != null && targets && deps.createLidarrClient) {
        const linkedLidarrTarget = getLinkedLidarrTarget(targets, job.targetId)
        const lidarrUrl = normalizeString(linkedLidarrTarget?.config.url)
        const lidarrApiKey = normalizeString(linkedLidarrTarget?.config.apiKey)
        if (linkedLidarrTarget && lidarrUrl && lidarrApiKey) {
          const lidarr = deps.createLidarrClient(
            lidarrUrl,
            lidarrApiKey,
            normalizeBoolean(linkedLidarrTarget.config.skipTlsVerify),
          )
          const albums = (await lidarr.getAlbums?.(job.lidarrArtistId)) ?? []
          if (isAlbumImported(job, albums)) {
            await deps.updateJobState(job.id, 'completed', { lastError: null })
            await updateRecommendationAction(job.recommendationId, job.targetId, 'added')
            return
          }
        }
      }

      await deps.updateJobState(job.id, 'failed', {
        lastError: `slskd transfer ${job.slskdDownloadId ?? job.slskdQueueId ?? 'unknown'} disappeared unexpectedly`,
      })
      await updateRecommendationAction(
        job.recommendationId,
        job.targetId,
        'failed',
        `slskd transfer ${job.slskdDownloadId ?? job.slskdQueueId ?? 'unknown'} disappeared unexpectedly`,
      )
      return
    }

    const transferState = normalizeDownloadState(download.state)
    if (transferState === 'failed') {
      await deps.updateJobState(job.id, 'failed', {
        slskdDownloadId: download.id,
        lastError: `slskd transfer failed with state ${download.state}`,
      })
      await updateRecommendationAction(
        job.recommendationId,
        job.targetId,
        'failed',
        `slskd transfer failed with state ${download.state}`,
      )
      return
    }

    if (transferState === 'queued') {
      await deps.updateJobState(job.id, 'queued', {
        slskdDownloadId: download.id,
        lastError: null,
      })
      await updateRecommendationAction(job.recommendationId, job.targetId, 'queued')
      return
    }

    if (transferState === 'downloading') {
      await deps.updateJobState(job.id, 'downloading', {
        slskdDownloadId: download.id,
        lastError: null,
      })
      await updateRecommendationAction(job.recommendationId, job.targetId, 'downloading')
      return
    }

    if (job.lidarrArtistId != null && targets && deps.createLidarrClient) {
      const linkedLidarrTarget = getLinkedLidarrTarget(targets, job.targetId)
      const lidarrUrl = normalizeString(linkedLidarrTarget?.config.url)
      const lidarrApiKey = normalizeString(linkedLidarrTarget?.config.apiKey)
      if (linkedLidarrTarget && lidarrUrl && lidarrApiKey) {
        const lidarr = deps.createLidarrClient(
          lidarrUrl,
          lidarrApiKey,
          normalizeBoolean(linkedLidarrTarget.config.skipTlsVerify),
        )
        const albums = (await lidarr.getAlbums?.(job.lidarrArtistId)) ?? []
        if (isAlbumImported(job, albums)) {
          await deps.updateJobState(job.id, 'completed', {
            slskdDownloadId: download.id,
            lastError: null,
          })
          await updateRecommendationAction(job.recommendationId, job.targetId, 'added')
          return
        }
      }

      await deps.updateJobState(job.id, 'import_pending', {
        slskdDownloadId: download.id,
        lastError: null,
      })
      await updateRecommendationAction(job.recommendationId, job.targetId, 'import_pending')
      return
    }

    await deps.updateJobState(job.id, 'completed', {
      slskdDownloadId: download.id,
      lastError: null,
    })
    await updateRecommendationAction(job.recommendationId, job.targetId, 'added')
  }

  async function processJobs(jobs: SlskdPendingJob[]) {
    if (!deps.createSlskdClient || jobs.length === 0) {
      return
    }

    const targets = deps.listTargets ? await deps.listTargets() : null
    const slskdClientCache = new Map<number, SlskdClient>()
    const createSlskdClient = deps.createSlskdClient

    function getSlskdClient(targetId: number): SlskdClient {
      const cached = slskdClientCache.get(targetId)
      if (cached) {
        return cached
      }

      const target = targets?.find(
        (candidate) => candidate.id === targetId && candidate.type === 'slskd',
      )
      const client = createSlskdClient(
        normalizeString(target?.config.url) ?? '',
        normalizeString(target?.config.apiKey) ?? '',
        normalizeBoolean(target?.config.skipTlsVerify),
      )
      slskdClientCache.set(targetId, client)
      return client
    }

    for (const job of jobs) {
      const slskd = getSlskdClient(job.targetId)

      if (job.state === 'pending' || job.state === 'searching') {
        await processSearchableJob(job, slskd)
        continue
      }

      await processTransferJob(job, slskd, targets)
    }
  }

  async function runSync(): Promise<void> {
    if (
      deps.listTargets &&
      deps.createLidarrClient &&
      deps.findActiveJobByWorkKey &&
      deps.createJob
    ) {
      await intakeWantedReleases()
    }
    const jobs = await deps.listPendingJobs(deps.limit)
    await processJobs(jobs as unknown as SlskdPendingJob[])
    await processPendingJobs(jobs)
  }

  return {
    get isSyncing() {
      return activeRun !== null
    },

    getActiveJobs(limit) {
      return deps.listPendingJobs(limit)
    },

    triggerSync() {
      if (activeRun) {
        return activeRun
      }

      activeRun = runSync()
        .catch((error) => {
          logger.error('[slskd] sync failed:', error)
          throw error
        })
        .finally(() => {
          activeRun = null
        })

      return activeRun
    },

    async warmup() {
      try {
        await this.triggerSync()
      } catch (error) {
        logger.error('[slskd] warmup sync failed:', error)
      }
    },
  }
}
