import type { createLidarrClient, LidarrCommand } from '@/core/clients/lidarr'
import type {
  SlskdDownloadUser,
  SlskdEnqueueResponse,
  SlskdSearchFile,
  SlskdSearchResult,
  SlskdTransferFile,
} from '@/core/clients/slskd'
import { buildLidarrManualImport } from '@/core/slskd/importer'
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

type SlskdClient = {
  createSearch: (queryText: string) => Promise<Record<string, unknown>>
  getSearchResults: (searchId: string) => Promise<SlskdSearchResult[]>
  enqueueResult: (searchId: string, result: SlskdSearchResult) => Promise<SlskdEnqueueResponse>
  getDownloads: () => Promise<SlskdDownloadUser[]>
}

type LidarrClient = Pick<
  ReturnType<typeof createLidarrClient>,
  | 'getWantedMissing'
  | 'getAlbums'
  | 'getManualImport'
  | 'updateManualImport'
  | 'manualImport'
  | 'getCommand'
  | 'getTracks'
>

type SlskdImportProgress = {
  commandId: number
  albumId: number
  expectedTrackIds: number[]
  checks: number
}

type SlskdSelectedRelease = {
  username: string
  files: SlskdSearchFile[]
  import?: SlskdImportProgress
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
  }) => Promise<{ id: number; state?: string }>
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

const MAX_IMPORT_CHECKS = 12

function normalizeBoolean(value: unknown): boolean {
  return value === true
}

function normalizeInteger(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function normalizeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function buildSearchQuery(job: SlskdPendingJob): string {
  return `${job.artistName} ${job.releaseTitle}`.trim()
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
        target.id === linkedId &&
        target.type === 'lidarr' &&
        target.userId === slskdTarget?.userId &&
        normalizeBoolean(target.enabled),
    ) ?? null
  )
}

function readSelectedRelease(value: Record<string, unknown> | null): SlskdSelectedRelease | null {
  if (!value) return null
  const username = normalizeString(value.username)
  if (!username || !Array.isArray(value.files)) return null

  const files = value.files.flatMap((raw): SlskdSearchFile[] => {
    if (!raw || typeof raw !== 'object') return []
    const file = raw as Record<string, unknown>
    const remoteFilename = normalizeString(file.filename)
    if (!remoteFilename || typeof file.size !== 'number') return []
    return [{ filename: remoteFilename, size: file.size }]
  })
  if (files.length === 0) return null

  const rawImport = value.import
  let importProgress: SlskdImportProgress | undefined
  if (rawImport && typeof rawImport === 'object') {
    const row = rawImport as Record<string, unknown>
    const commandId = normalizeInteger(row.commandId)
    const albumId = normalizeInteger(row.albumId)
    const expectedTrackIds = Array.isArray(row.expectedTrackIds)
      ? row.expectedTrackIds.flatMap((id) => {
          const parsed = normalizeInteger(id)
          return parsed == null ? [] : [parsed]
        })
      : []
    if (commandId && albumId && expectedTrackIds.length > 0) {
      importProgress = {
        commandId,
        albumId,
        expectedTrackIds,
        checks: Math.max(0, Number(row.checks) || 0),
      }
    }
  }

  return {
    username,
    files,
    ...(importProgress ? { import: importProgress } : {}),
  }
}

function persistSelectedRelease(candidate: SlskdSearchResult): SlskdSelectedRelease {
  const files = candidate.files ?? [{ filename: candidate.filename, size: candidate.size }]
  return {
    username: candidate.username,
    files,
  }
}

function flattenDownloads(downloads: SlskdDownloadUser[]): SlskdTransferFile[] {
  return downloads.flatMap((user) =>
    (user.directories ?? []).flatMap((directory) =>
      (directory.files ?? []).map((file) => ({
        ...file,
        username: file.username || user.username,
      })),
    ),
  )
}

function findTransfers(
  selected: SlskdSelectedRelease,
  downloads: SlskdDownloadUser[],
  batchId: string | null,
): Array<{ expected: SlskdSearchFile; transfer?: SlskdTransferFile }> {
  const transfers = flattenDownloads(downloads)
  return selected.files.map((expected) => ({
    expected,
    transfer: transfers.find(
      (transfer) =>
        (batchId == null || transfer.batchId === batchId) &&
        transfer.username === selected.username &&
        transfer.filename === expected.filename,
    ),
  }))
}

function transferSucceeded(state: string): boolean {
  return state.trim().toLowerCase() === 'completed, succeeded'
}

function transferFailed(state: string): boolean {
  const normalized = state.trim().toLowerCase()
  return (
    (normalized.startsWith('completed') && normalized !== 'completed, succeeded') ||
    normalized.includes('rejected') ||
    normalized.includes('errored') ||
    normalized.includes('failed') ||
    normalized.includes('cancel')
  )
}

function commandFailed(command: LidarrCommand): boolean {
  const state = command.status.trim().toLowerCase()
  return state.includes('fail') || state.includes('abort') || state.includes('cancel')
}

function commandCompleted(command: LidarrCommand): boolean {
  return command.status.trim().toLowerCase() === 'completed'
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

  async function failJob(job: SlskdPendingJob, error: string) {
    await deps.updateJobState?.(job.id, 'failed', { lastError: error })
    await updateRecommendationAction(job.recommendationId, job.targetId, 'failed', error)
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
      for (const release of await lidarr.getWantedMissing()) {
        const artistMbid =
          normalizeString(release.artist?.foreignArtistId) ??
          normalizeString(release.foreignArtistId)
        const artistName =
          normalizeString(release.artist?.artistName) ?? normalizeString(release.artistName)
        const releaseGroupMbid = normalizeString(release.foreignAlbumId)
        if (!artistMbid || !artistName || !releaseGroupMbid) continue
        const workKey = buildSlskdWorkKey(slskdTarget.id, artistMbid, releaseGroupMbid)
        if (await deps.findActiveJobByWorkKey(workKey)) continue
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
    const searchQuery = buildSearchQuery(job)
    if (!searchQuery) {
      await failJob(job, 'slskd job requires an artist name or release title')
      return
    }

    let searchId = job.slskdSearchId
    if (!searchId) {
      await deps.updateJobState(job.id, 'searching', {
        attempts: job.attempts + 1,
        lastError: null,
      })
      const search = await slskd.createSearch(searchQuery)
      searchId = normalizeString(search.id)
      if (!searchId) throw new Error(`slskd search did not return an id for job ${job.id}`)
      await deps.updateJobState(job.id, 'searching', { slskdSearchId: searchId, lastError: null })
    }

    const results = await slskd.getSearchResults(searchId)
    if (results.length === 0) return
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

    const enqueue = await slskd.enqueueResult(searchId, selected.candidate)
    if (enqueue.failures.length > 0) {
      const details = enqueue.failures
        .map((failure) => `${failure.filename}: ${failure.message}`)
        .join('; ')
      throw new Error(`slskd failed to enqueue the complete release: ${details}`)
    }
    await deps.updateJobState(job.id, 'queued', {
      confidence: selected.confidence,
      slskdSearchId: searchId,
      slskdQueueId: enqueue.batch.id,
      selectedResult: persistSelectedRelease(selected.candidate),
      lastError: null,
    })
    await updateRecommendationAction(job.recommendationId, job.targetId, 'queued')
  }

  function getLidarrClientForJob(job: SlskdPendingJob, targets: SlskdTargetRow[]) {
    if (!deps.createLidarrClient) return null
    const linked = getLinkedLidarrTarget(targets, job.targetId)
    const url = normalizeString(linked?.config.url)
    const apiKey = normalizeString(linked?.config.apiKey)
    if (!linked || !url || !apiKey) return null
    return deps.createLidarrClient(url, apiKey, normalizeBoolean(linked.config.skipTlsVerify))
  }

  async function processImportPending(
    job: SlskdPendingJob,
    selected: SlskdSelectedRelease,
    lidarr: LidarrClient,
  ): Promise<boolean> {
    const progress = selected.import
    if (!progress) return false
    const command = await lidarr.getCommand(progress.commandId)
    if (commandFailed(command)) {
      await failJob(
        job,
        command.message ?? `Lidarr ManualImport command ${progress.commandId} failed`,
      )
      return true
    }

    let imported = false
    if (commandCompleted(command)) {
      const tracks = await lidarr.getTracks(progress.albumId)
      imported = progress.expectedTrackIds.every(
        (id) => tracks.find((track) => track.id === id)?.hasFile === true,
      )
    }
    if (imported) {
      await deps.updateJobState?.(job.id, 'completed', { lastError: null })
      await updateRecommendationAction(job.recommendationId, job.targetId, 'added')
      return true
    }

    const checks = progress.checks + 1
    if (checks >= MAX_IMPORT_CHECKS) {
      await failJob(
        job,
        `Lidarr ManualImport command ${progress.commandId} did not import every expected track`,
      )
      return true
    }
    await deps.updateJobState?.(job.id, 'import_pending', {
      selectedResult: { ...selected, import: { ...progress, checks } },
      lastError: null,
    })
    await updateRecommendationAction(job.recommendationId, job.targetId, 'import_pending')
    return true
  }

  async function processTransferJob(
    job: SlskdPendingJob,
    slskd: SlskdClient,
    targets: SlskdTargetRow[] | null,
  ) {
    if (!deps.updateJobState) return
    const selected = readSelectedRelease(job.selectedResult)
    if (!selected) {
      await failJob(job, 'slskd job is missing its selected release manifest')
      return
    }

    const lidarr = targets ? getLidarrClientForJob(job, targets) : null
    if (job.state === 'import_pending') {
      if (!selected.import || !lidarr) {
        await failJob(
          job,
          'Lidarr import cannot be verified: its checkpoint or linked target is missing',
        )
        return
      }
      await processImportPending(job, selected, lidarr)
      return
    }

    const matches = findTransfers(selected, await slskd.getDownloads(), job.slskdQueueId)
    const failed = matches.find((match) => match.transfer && transferFailed(match.transfer.state))
    if (failed?.transfer) {
      const suffix = failed.transfer.exception ? `: ${failed.transfer.exception}` : ''
      await failJob(
        job,
        `slskd transfer ${failed.expected.filename} ended as ${failed.transfer.state}${suffix}`,
      )
      return
    }

    const firstTransferId = matches.find((match) => match.transfer)?.transfer?.id
    if (matches.some((match) => !match.transfer || !transferSucceeded(match.transfer.state))) {
      const state = matches.some(
        (match) => match.transfer && !match.transfer.state.toLowerCase().includes('queued'),
      )
        ? 'downloading'
        : 'queued'
      await deps.updateJobState(job.id, state, {
        slskdDownloadId: firstTransferId ?? job.slskdDownloadId,
        lastError: null,
      })
      await updateRecommendationAction(job.recommendationId, job.targetId, state)
      return
    }

    const linkedTarget = targets ? getLinkedLidarrTarget(targets, job.targetId) : null
    if (!linkedTarget && job.lidarrArtistId != null) {
      await failJob(job, 'Lidarr import cannot proceed: its linked target is missing')
      return
    }
    if (job.lidarrArtistId == null) {
      await deps.updateJobState(job.id, 'completed', {
        slskdDownloadId: firstTransferId ?? job.slskdDownloadId,
        lastError: null,
      })
      await updateRecommendationAction(job.recommendationId, job.targetId, 'added')
      return
    }
    if (!lidarr) throw new Error('linked Lidarr manual import is unavailable')
    const lidarrDownloadPath = normalizeString(
      targets?.find((target) => target.id === job.targetId)?.config.lidarrDownloadPath,
    )
    if (!lidarrDownloadPath) {
      throw new Error('linked slskd target requires lidarrDownloadPath for imports')
    }
    const manualImport = await buildLidarrManualImport(job, selected, lidarrDownloadPath, lidarr)
    if (manualImport.alreadyComplete) {
      const message = 'Lidarr already has every expected track; source files were left untouched'
      await deps.updateJobState(job.id, 'cancelled', { lastError: message })
      await updateRecommendationAction(job.recommendationId, job.targetId, 'skipped', message)
      return
    }
    const command = await lidarr.manualImport(manualImport.files)
    const commandId = normalizeInteger(command.id)
    if (!commandId) throw new Error('Lidarr ManualImport did not return a command id')
    await deps.updateJobState(job.id, 'import_pending', {
      slskdDownloadId: firstTransferId ?? job.slskdDownloadId,
      selectedResult: {
        ...selected,
        import: {
          commandId,
          albumId: manualImport.albumId,
          expectedTrackIds: manualImport.expectedTrackIds,
          checks: 0,
        },
      },
      lastError: null,
    })
    await updateRecommendationAction(job.recommendationId, job.targetId, 'import_pending')
  }

  async function processJobs(jobs: SlskdPendingJob[]) {
    if (!deps.createSlskdClient || jobs.length === 0) return
    const targets = deps.listTargets ? await deps.listTargets() : null
    const cache = new Map<number, SlskdClient>()
    const createClient = deps.createSlskdClient
    function getSlskdClient(targetId: number): SlskdClient {
      const cached = cache.get(targetId)
      if (cached) return cached
      const target = targets?.find(
        (candidate) => candidate.id === targetId && candidate.type === 'slskd',
      )
      const client = createClient(
        normalizeString(target?.config.url) ?? '',
        normalizeString(target?.config.apiKey) ?? '',
        normalizeBoolean(target?.config.skipTlsVerify),
      )
      cache.set(targetId, client)
      return client
    }

    for (const job of jobs) {
      try {
        if (targets) {
          const target = targets.find(
            (candidate) => candidate.id === job.targetId && candidate.type === 'slskd',
          )
          if (!target || target.userId !== job.userId) {
            throw new Error('slskd job target is missing or its owner changed')
          }
          if (target.config.lidarrTargetId != null && !getLinkedLidarrTarget(targets, target.id)) {
            throw new Error('slskd job linked Lidarr target is unavailable for its owner')
          }
        }
        const slskd = getSlskdClient(job.targetId)
        if (job.state === 'pending' || job.state === 'searching') {
          await processSearchableJob(job, slskd)
        } else {
          await processTransferJob(job, slskd, targets)
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        logger.error(`[slskd] Job ${job.id} (${job.state}) failed:`, err)
        try {
          await failJob(job, message)
        } catch (markErr) {
          logger.error(`[slskd] Failed to mark job ${job.id} as failed:`, markErr)
        }
      }
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
      if (activeRun) return activeRun
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
