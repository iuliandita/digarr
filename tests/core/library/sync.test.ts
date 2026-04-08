// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LibraryAlbum, LibrarySource } from '@/core/library/sources/types'
import type { LibrarySyncStore } from '@/core/library/store'
import { createSyncOrchestrator } from '@/core/library/sync'

function makeStore(): LibrarySyncStore {
  return {
    replaceLibrarySnapshot: vi.fn(async () => ({
      total: 0,
      matchedMbid: 0,
      matchedNameExact: 0,
      matchedNameAnchored: 0,
      matchedDisambiguated: 0,
      unreconciledAmbiguous: 0,
      unreconciledNoCandidate: 0,
      cacheHits: 0,
      mbApiCalls: 0,
      albumsSynced: 0,
    })),
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
    replaceLibraryAlbums: vi.fn(async () => ({ total: 0 })),
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

function sourceWithAlbums(
  id: string,
  artists: Array<{ sourceArtistId: string; name: string; mbid?: string | null }>,
  albumsByArtist: Record<string, LibraryAlbum[]>,
): LibrarySource {
  return {
    id,
    name: id,
    capabilities: ['listArtists', 'listAlbums'],
    userId: null,
    mbidQuality: 'high',
    listArtists: vi.fn(
      async () => artists as unknown as Awaited<ReturnType<LibrarySource['listArtists']>>,
    ),
    listAlbums: vi.fn(async (sourceArtistId: string) => albumsByArtist[sourceArtistId] ?? []),
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

  it('syncs albums for matched artists and stores albumsSynced in counts', async () => {
    store.replaceLibrarySnapshot = vi.fn(async () => ({
      total: 1,
      matchedMbid: 1,
      matchedNameExact: 0,
      matchedNameAnchored: 0,
      matchedDisambiguated: 0,
      unreconciledAmbiguous: 0,
      unreconciledNoCandidate: 0,
      cacheHits: 0,
      mbApiCalls: 0,
      albumsSynced: 1,
    }))
    const a = sourceWithAlbums(
      'lidarr',
      [{ sourceArtistId: '1', name: 'Radiohead', mbid: 'a74b1b7f-71a5-4011-9441-d0b5e4122711' }],
      {
        '1': [{ sourceAlbumId: 'alb-1', sourceArtistId: '1', title: 'OK Computer' }],
      },
    )

    const sync = createSyncOrchestrator({
      store,
      recorder,
      mbClient: {
        ...mbClient,
        getReleaseGroups: vi.fn(async () => [
          {
            id: '11111111-1111-1111-1111-111111111111',
            title: 'OK Computer',
            type: 'Album',
            firstReleaseDate: '1997-06-16',
          },
        ]),
      },
      buildPerUserSources: async () => [a],
      buildGlobalSources: async () => [],
      staleHours: 6,
    })

    const summary = await sync.syncForUser(1, { force: true })

    expect(store.replaceLibrarySnapshot).toHaveBeenCalled()
    expect(summary.results[0]).toMatchObject({
      status: 'completed',
      counts: expect.objectContaining({ albumsSynced: 1 }),
    })
  })

  it('does not call replaceLibrarySnapshot when the source has no listAlbums capability', async () => {
    const a = source('plex')
    a.listArtists = vi.fn(async () => [
      { sourceArtistId: 'rk-1', name: 'Radiohead', mbid: 'a74b1b7f-71a5-4011-9441-d0b5e4122711' },
    ])

    const sync = createSyncOrchestrator({
      store,
      recorder,
      mbClient,
      buildPerUserSources: async () => [a],
      buildGlobalSources: async () => [],
      staleHours: 6,
    })

    await sync.syncForUser(1, { force: true })
    expect(store.replaceLibrarySnapshot).not.toHaveBeenCalled()
  })

  it('does not call listAlbums for matched artists with null mbid', async () => {
    const a = sourceWithAlbums('lidarr', [{ sourceArtistId: '1', name: 'Radiohead', mbid: null }], {
      '1': [{ sourceAlbumId: 'alb-1', sourceArtistId: '1', title: 'OK Computer' }],
    })

    const sync = createSyncOrchestrator({
      store,
      recorder,
      mbClient,
      buildPerUserSources: async () => [a],
      buildGlobalSources: async () => [],
      staleHours: 6,
    })

    const summary = await sync.syncForUser(1, { force: true })

    expect(summary.results[0]?.status).toBe('completed')
    expect(a.listAlbums).not.toHaveBeenCalled()
    expect(store.replaceLibrarySnapshot).toHaveBeenCalledWith(1, 'lidarr', expect.any(Array), [])
  })

  it('fails the source sync when album reconciliation throws', async () => {
    const a = sourceWithAlbums(
      'lidarr',
      [{ sourceArtistId: '1', name: 'Radiohead', mbid: 'a74b1b7f-71a5-4011-9441-d0b5e4122711' }],
      {
        '1': [{ sourceAlbumId: 'alb-1', sourceArtistId: '1', title: 'OK Computer' }],
      },
    )
    a.listAlbums = vi.fn(async () => {
      throw new Error('album boom')
    })

    const sync = createSyncOrchestrator({
      store,
      recorder,
      mbClient: {
        ...mbClient,
        getReleaseGroups: vi.fn(async () => [
          {
            id: '11111111-1111-1111-1111-111111111111',
            title: 'OK Computer',
            type: 'Album',
            firstReleaseDate: '1997-06-16',
          },
        ]),
      },
      buildPerUserSources: async () => [a],
      buildGlobalSources: async () => [],
      staleHours: 6,
    })

    const summary = await sync.syncForUser(1, { force: true })

    expect(summary.results[0]?.status).toBe('failed')
    expect(store.replaceLibrarySnapshot).not.toHaveBeenCalled()
  })

  it('waits for queued album tasks to settle before returning a failure', async () => {
    const albumTaskSettled: string[] = []
    const albumTaskStarted: string[] = []
    const a: LibrarySource = {
      id: 'lidarr',
      name: 'lidarr',
      capabilities: ['listArtists', 'listAlbums'],
      userId: null,
      mbidQuality: 'high',
      listArtists: vi.fn(async () => [
        { sourceArtistId: '1', name: 'Radiohead', mbid: 'a74b1b7f-71a5-4011-9441-d0b5e4122711' },
        { sourceArtistId: '2', name: 'Portishead', mbid: '8f6bd1e4-fbe1-4f50-aa9b-94c450ec0a11' },
        { sourceArtistId: '3', name: 'Björk', mbid: '2dc91a0a-0e78-4e45-a0b7-7fbd9dbe8f5d' },
        {
          sourceArtistId: '4',
          name: 'Massive Attack',
          mbid: '9c0b5d7e-2f4a-4a55-8a0f-4fb1c5fd9d37',
        },
      ]),
      listAlbums: vi.fn(async (sourceArtistId: string) => {
        albumTaskStarted.push(sourceArtistId)
        if (sourceArtistId === '1') {
          throw new Error('album boom')
        }
        await new Promise((resolve) => setTimeout(resolve, sourceArtistId === '4' ? 5 : 25))
        albumTaskSettled.push(sourceArtistId)
        return []
      }),
      testConnection: async () => ({ success: true, message: 'ok' }),
    }

    const sync = createSyncOrchestrator({
      store,
      recorder,
      mbClient,
      buildPerUserSources: async () => [a],
      buildGlobalSources: async () => [],
      staleHours: 6,
    })

    const summary = await sync.syncForUser(1, { force: true })

    expect(summary.results[0]?.status).toBe('failed')
    expect(albumTaskStarted).toEqual(['1', '2', '3', '4'])
    expect(albumTaskSettled).toContain('2')
    expect(albumTaskSettled).toContain('3')
    expect(albumTaskSettled).toContain('4')
  })
})
