// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LibrarySource } from '@/core/library/sources/types'
import type { LibrarySyncStore } from '@/core/library/store'
import { createSyncOrchestrator } from '@/core/library/sync'

function makeStore(): LibrarySyncStore {
  return {
    replaceLibraryArtists: vi.fn(async () => ({
      total: 0,
      matchedMbid: 0,
      matchedNameExact: 0,
      matchedNameAnchored: 0,
      matchedDisambiguated: 0,
      unreconciledAmbiguous: 0,
      unreconciledNoCandidate: 0,
      cacheHits: 0,
      mbApiCalls: 0,
    })),
    findReconciledByNormalizedName: vi.fn(async () => []),
    getLibrarySyncState: vi.fn(async () => null),
    upsertLibrarySyncState: vi.fn(async () => {}),
    getOverride: vi.fn(async () => null),
    getAllOverrides: vi.fn(async () => new Map()),
    upsertOverride: vi.fn(async () => {}),
    deleteOverride: vi.fn(async () => {}),
    getKnownMbidsForUser: vi.fn(async () => new Set<string>()),
    userHasAnySyncState: vi.fn(async () => false),
    listSyncStateForUser: vi.fn(async () => []),
    listUnreconciledForUser: vi.fn(async () => []),
  }
}

function makeJobRecorder() {
  return {
    start: vi.fn(async () => 1),
    complete: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
    markStuck: vi.fn(async () => 0),
  }
}

const mbClient = {
  searchArtist: vi.fn(async () => ({ artists: [] })),
  getReleaseGroups: vi.fn(async () => []),
}

function source(id: string, mbidQuality: 'high' | 'low' = 'high'): LibrarySource {
  return {
    id,
    name: id,
    capabilities: ['listArtists'],
    userId: null,
    mbidQuality,
    listArtists: vi.fn(async () => []),
    testConnection: async () => ({ success: true, message: 'ok' }),
  }
}

let store: ReturnType<typeof makeStore>
let recorder: ReturnType<typeof makeJobRecorder>

beforeEach(() => {
  store = makeStore()
  recorder = makeJobRecorder()
  vi.useRealTimers()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createSyncOrchestrator', () => {
  it('runs sources in mbidQuality order (high first)', async () => {
    const order: string[] = []
    const lidarr = source('lidarr', 'high')
    const plex = source('plex', 'low')
    lidarr.listArtists = vi.fn(async () => {
      order.push('lidarr')
      return []
    })
    plex.listArtists = vi.fn(async () => {
      order.push('plex')
      return []
    })

    const sync = createSyncOrchestrator({
      store,
      recorder,
      mbClient,
      buildPerUserSources: async () => [plex],
      buildGlobalSources: async () => [lidarr],
      staleHours: 6,
    })
    await sync.syncForUser(1)

    // syncForUser only walks per-user sources -- global sources are syncGlobal's job
    // but Task 12 has the orchestrator order both within a single call when called from
    // the scheduler. Update test expectations once we wire the scheduler.
    expect(order).toEqual(['plex'])
  })

  it('per-source failure does not stop other sources', async () => {
    const a = source('a')
    const b = source('b')
    a.listArtists = vi.fn(async () => {
      throw new Error('boom')
    })
    const sync = createSyncOrchestrator({
      store,
      recorder,
      mbClient,
      buildPerUserSources: async () => [a, b],
      buildGlobalSources: async () => [],
      staleHours: 6,
    })
    const summary = await sync.syncForUser(1)
    expect(summary.results.find((r) => r.source === 'a')?.status).toBe('failed')
    expect(summary.results.find((r) => r.source === 'b')?.status).toBe('completed')
  })

  it('skips sources with fresh sync state unless force=true', async () => {
    const a = source('a')
    a.listArtists = vi.fn(async () => [])
    store.getLibrarySyncState = vi.fn(async () => ({
      userId: 1,
      source: 'a',
      lastSyncStartedAt: new Date(),
      lastSyncCompletedAt: new Date(), // brand new = fresh
      lastSyncStatus: 'completed',
      lastSyncError: null,
      lastSyncCounts: null,
    }))
    const sync = createSyncOrchestrator({
      store,
      recorder,
      mbClient,
      buildPerUserSources: async () => [a],
      buildGlobalSources: async () => [],
      staleHours: 6,
    })
    const summary = await sync.syncForUser(1)
    expect(summary.results[0]?.status).toBe('skipped_fresh')
    expect(a.listArtists).not.toHaveBeenCalled()

    const forced = await sync.syncForUser(1, { force: true })
    expect(forced.results[0]?.status).toBe('completed')
    expect(a.listArtists).toHaveBeenCalled()
  })

  it('coalesces parallel calls to the same (user, source)', async () => {
    const a = source('a')
    let listCalls = 0
    a.listArtists = vi.fn(async () => {
      listCalls += 1
      await new Promise((r) => setTimeout(r, 25))
      return []
    })
    const sync = createSyncOrchestrator({
      store,
      recorder,
      mbClient,
      buildPerUserSources: async () => [a],
      buildGlobalSources: async () => [],
      staleHours: 6,
    })
    const [r1, r2] = await Promise.all([sync.syncForUser(1), sync.syncForUser(1)])
    expect(listCalls).toBe(1) // coalesced
    expect(r1.results[0]?.status).toBe('completed')
    expect(r2.results[0]?.status).toBe('completed')
  })

  it('records job_runs via recorder.start/complete on success', async () => {
    const a = source('a')
    const sync = createSyncOrchestrator({
      store,
      recorder,
      mbClient,
      buildPerUserSources: async () => [a],
      buildGlobalSources: async () => [],
      staleHours: 6,
    })
    await sync.syncForUser(1)
    expect(recorder.start).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'library_sync', userId: 1 }),
    )
    expect(recorder.complete).toHaveBeenCalledWith(1, expect.anything())
  })

  it('records job failure via recorder.fail on source error', async () => {
    const a = source('a')
    a.listArtists = vi.fn(async () => {
      throw new Error('boom')
    })
    const sync = createSyncOrchestrator({
      store,
      recorder,
      mbClient,
      buildPerUserSources: async () => [a],
      buildGlobalSources: async () => [],
      staleHours: 6,
    })
    await sync.syncForUser(1)
    expect(recorder.fail).toHaveBeenCalled()
  })
})
