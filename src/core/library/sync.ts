import type { createMusicBrainzClient } from '@/core/clients/musicbrainz'
import type { JobRecorder, JobType } from '@/core/jobs/types'
import { errMsg } from '@/core/validation'
import { type ReconcilerContext, reconcileArtist } from './reconciler'
import type { LibrarySource } from './sources/types'
import { emptyLibrarySyncCounts, type LibrarySyncStore } from './store'

const LIBRARY_SYNC_JOB_TYPE: JobType = 'library_sync'

/** Sentinel substring used by callers to detect "source not configured" failures
 *  and trigger fallback retry logic. Keep in sync with syncSpecificSource error msg. */
export const SOURCE_NOT_CONFIGURED_ERROR = 'not configured'

type MBClient = Pick<
  ReturnType<typeof createMusicBrainzClient>,
  'searchArtist' | 'getReleaseGroups'
>

export type SourceSyncResult =
  | {
      source: string
      status: 'completed'
      counts: ReconcilerContext['counts']
    }
  | {
      source: string
      status: 'skipped_fresh'
      counts: ReconcilerContext['counts'] | null
    }
  | {
      source: string
      status: 'failed'
      error: string
    }

export type SyncSummary = {
  userId: number | null
  results: SourceSyncResult[]
}

export type SyncOptions = {
  force?: boolean
  onProgress?: (msg: string) => void
}

export type SyncOrchestratorDeps = {
  store: LibrarySyncStore
  recorder: JobRecorder
  mbClient: MBClient
  buildPerUserSources: (userId: number) => Promise<LibrarySource[]>
  buildGlobalSources: () => Promise<LibrarySource[]>
  /** Stale threshold in hours; matches settings.librarySyncIntervalHours */
  staleHours: number
}

export function createSyncOrchestrator(deps: SyncOrchestratorDeps) {
  const inFlight = new Map<string, Promise<SourceSyncResult>>()

  function isStale(lastCompleted: Date | null): boolean {
    if (!lastCompleted) return true
    const ageMs = Date.now() - lastCompleted.getTime()
    return ageMs > deps.staleHours * 60 * 60 * 1000
  }

  async function syncSource(
    source: LibrarySource,
    userId: number | null,
    options?: SyncOptions,
  ): Promise<SourceSyncResult> {
    const key = `${userId ?? 'global'}:${source.id}`
    const existing = inFlight.get(key)
    if (existing) return existing

    const promise = doSync(source, userId, options).finally(() => {
      inFlight.delete(key)
    })
    inFlight.set(key, promise)
    return promise
  }

  async function doSync(
    source: LibrarySource,
    userId: number | null,
    options?: SyncOptions,
  ): Promise<SourceSyncResult> {
    if (!options?.force) {
      const state = await deps.store.getLibrarySyncState(userId, source.id)
      if (state?.lastSyncCompletedAt && !isStale(state.lastSyncCompletedAt)) {
        return { source: source.id, status: 'skipped_fresh', counts: state.lastSyncCounts }
      }
    }

    let jobId: number | null = null
    try {
      jobId = await deps.recorder.start({
        type: LIBRARY_SYNC_JOB_TYPE,
        userId: userId ?? undefined,
        metadata: { source: source.id },
      })

      await deps.store.upsertLibrarySyncState(userId, source.id, {
        lastSyncStartedAt: new Date(),
        lastSyncStatus: 'running',
        lastSyncError: null,
      })

      options?.onProgress?.(`Syncing ${source.name}...`)
      const rawArtists = await source.listArtists()

      const overrides = userId != null ? await deps.store.getAllOverrides(userId) : new Map()
      const knownMbids =
        userId != null ? await deps.store.getKnownMbidsForUser(userId) : new Set<string>()
      const counts = emptyLibrarySyncCounts()
      const ctx: ReconcilerContext = {
        userId,
        overrides,
        knownMbids,
        mbClient: deps.mbClient,
        cacheLookup: (nameNormalized) =>
          userId != null
            ? deps.store.findReconciledByNormalizedName(userId, nameNormalized)
            : Promise.resolve([]),
        counts,
      }

      const reconciled = []
      for (const artist of rawArtists) {
        reconciled.push(await reconcileArtist(artist, source.id, ctx))
      }

      const writtenCounts = await deps.store.replaceLibraryArtists(userId, source.id, reconciled)
      // Merge writer counts (tally pass) with reconciler counts (cacheHits, mbApiCalls)
      const merged = {
        ...writtenCounts,
        cacheHits: counts.cacheHits,
        mbApiCalls: counts.mbApiCalls,
      }

      await deps.store.upsertLibrarySyncState(userId, source.id, {
        lastSyncCompletedAt: new Date(),
        lastSyncStatus: 'completed',
        lastSyncError: null,
        lastSyncCounts: merged,
      })
      await deps.recorder.complete(jobId, { metadata: { counts: merged } })
      return { source: source.id, status: 'completed', counts: merged }
    } catch (err: unknown) {
      const error = errMsg(err)
      // The state-update itself can fail if the DB is the source of the original error.
      // Swallow secondary failures so they don't escape doSync.
      try {
        await deps.store.upsertLibrarySyncState(userId, source.id, {
          lastSyncStatus: 'failed',
          lastSyncError: error,
        })
      } catch {
        // best-effort
      }
      if (jobId !== null) {
        try {
          await deps.recorder.fail(jobId, error)
        } catch {
          // best-effort
        }
      }
      return { source: source.id, status: 'failed', error }
    }
  }

  async function runSourcesIsolated(
    sources: LibrarySource[],
    userId: number | null,
    options?: SyncOptions,
  ): Promise<SourceSyncResult[]> {
    const ordered = [...sources].sort((a, b) => {
      if (a.mbidQuality === b.mbidQuality) return 0
      return a.mbidQuality === 'high' ? -1 : 1
    })
    const results: SourceSyncResult[] = []
    for (const src of ordered) {
      results.push(await syncSource(src, userId, options))
    }
    return results
  }

  return {
    async syncGlobal(options?: SyncOptions): Promise<SyncSummary> {
      const sources = await deps.buildGlobalSources()
      const results = await runSourcesIsolated(sources, null, options)
      return { userId: null, results }
    },

    async syncForUser(userId: number, options?: SyncOptions): Promise<SyncSummary> {
      const sources = await deps.buildPerUserSources(userId)
      const results = await runSourcesIsolated(sources, userId, options)
      return { userId, results }
    },

    async syncSpecificSource(
      userId: number | null,
      sourceId: string,
      options?: SyncOptions,
    ): Promise<SourceSyncResult> {
      const sources =
        userId === null ? await deps.buildGlobalSources() : await deps.buildPerUserSources(userId)
      const src = sources.find((s) => s.id === sourceId)
      if (!src) {
        return {
          source: sourceId,
          status: 'failed',
          error: `Source '${sourceId}' ${SOURCE_NOT_CONFIGURED_ERROR}`,
        }
      }
      return syncSource(src, userId, options)
    },
  }
}

export type SyncOrchestrator = ReturnType<typeof createSyncOrchestrator>
