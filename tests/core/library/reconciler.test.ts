// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { type ReconcilerContext, reconcileArtist } from '@/core/library/reconciler'
import type { LibraryArtist } from '@/core/library/sources/types'

function makeCtx(overrides: Partial<ReconcilerContext> = {}): ReconcilerContext {
  return {
    userId: 1,
    overrides: new Map(),
    knownMbids: new Set(),
    mbClient: {
      searchArtist: vi.fn().mockResolvedValue({ artists: [] }),
      getReleaseGroups: vi.fn().mockResolvedValue([]),
    },
    cacheLookup: vi.fn().mockResolvedValue([]),
    counts: {
      total: 0,
      matchedMbid: 0,
      matchedNameExact: 0,
      matchedNameAnchored: 0,
      matchedDisambiguated: 0,
      unreconciledAmbiguous: 0,
      unreconciledNoCandidate: 0,
      cacheHits: 0,
      mbApiCalls: 0,
    },
    ...overrides,
  }
}

const VALID_MBID = 'a74b1b7f-71a5-4011-9441-d0b5e4122711'
const OTHER_MBID = '8f6bd1e4-fbe1-4f50-aa9b-94c450ec0a11'

describe('reconcileArtist -- Step 0 (override)', () => {
  it('returns matched row when override has correctMbid', async () => {
    const overrides = new Map([['plex:rk-1', { correctMbid: OTHER_MBID }]])
    const artist: LibraryArtist = { sourceArtistId: 'rk-1', name: 'Bush' }
    const result = await reconcileArtist(artist, 'plex', makeCtx({ overrides }))
    expect(result.mbid).toBe(OTHER_MBID)
    expect(result.matchMethod).toBe('mbid')
    expect(result.matchConfidence).toBe(1.0)
  })

  it('returns unreconciled with reason "override_skip" when override has null mbid', async () => {
    const overrides = new Map([['plex:rk-1', { correctMbid: null }]])
    const artist: LibraryArtist = { sourceArtistId: 'rk-1', name: 'Bush' }
    const result = await reconcileArtist(artist, 'plex', makeCtx({ overrides }))
    expect(result.mbid).toBeNull()
    expect(result.unreconciledReason).toBe('override_skip')
  })

  it('override beats source-provided MBID', async () => {
    const overrides = new Map([['plex:rk-1', { correctMbid: OTHER_MBID }]])
    const artist: LibraryArtist = { sourceArtistId: 'rk-1', name: 'Bush', mbid: VALID_MBID }
    const result = await reconcileArtist(artist, 'plex', makeCtx({ overrides }))
    expect(result.mbid).toBe(OTHER_MBID)
  })
})

describe('reconcileArtist -- Step 1 (source-provided MBID)', () => {
  it('trusts source MBID when present and valid', async () => {
    const artist: LibraryArtist = { sourceArtistId: 'lid-1', name: 'Radiohead', mbid: VALID_MBID }
    const result = await reconcileArtist(artist, 'lidarr', makeCtx())
    expect(result.mbid).toBe(VALID_MBID)
    expect(result.matchMethod).toBe('mbid')
    expect(result.matchConfidence).toBe(1.0)
  })

  it('ignores invalid MBIDs and falls through to MB lookup', async () => {
    const ctx = makeCtx({
      mbClient: {
        searchArtist: vi.fn().mockResolvedValue({ artists: [] }),
        getReleaseGroups: vi.fn().mockResolvedValue([]),
      },
    })
    const artist: LibraryArtist = { sourceArtistId: 'lid-1', name: 'Bogus', mbid: 'not-a-uuid' }
    const result = await reconcileArtist(artist, 'lidarr', ctx)
    expect(result.matchMethod).toBeNull() // unreconciled, fell through
    expect(ctx.mbClient.searchArtist).toHaveBeenCalled()
  })
})

describe('reconcileArtist -- Step 2 (cache short-circuit)', () => {
  it('uses cache hit when exactly one match in library_artists by normalized name', async () => {
    const ctx = makeCtx({
      cacheLookup: vi
        .fn()
        .mockResolvedValue([{ mbid: VALID_MBID, name: 'Bush', source: 'lidarr' }]),
    })
    const artist: LibraryArtist = { sourceArtistId: 'rk-1', name: 'Bush' }
    const result = await reconcileArtist(artist, 'plex', ctx)
    expect(result.mbid).toBe(VALID_MBID)
    expect(result.matchMethod).toBe('name_anchored')
    expect(result.matchConfidence).toBe(0.85)
    expect(ctx.counts.cacheHits).toBe(1)
    expect(ctx.mbClient.searchArtist).not.toHaveBeenCalled()
  })

  it('falls through to MB API when cache returns multiple matches (ambiguous)', async () => {
    const ctx = makeCtx({
      cacheLookup: vi.fn().mockResolvedValue([
        { mbid: VALID_MBID, name: 'Bush', source: 'lidarr' },
        { mbid: OTHER_MBID, name: 'Bush', source: 'jellyfin' },
      ]),
    })
    const artist: LibraryArtist = { sourceArtistId: 'rk-1', name: 'Bush' }
    await reconcileArtist(artist, 'plex', ctx)
    expect(ctx.mbClient.searchArtist).toHaveBeenCalled()
  })

  it('returns unreconciled "no_candidate" when MB returns no normalized matches', async () => {
    const ctx = makeCtx({
      mbClient: {
        searchArtist: vi.fn().mockResolvedValue({ artists: [] }),
        getReleaseGroups: vi.fn(),
      },
    })
    const artist: LibraryArtist = { sourceArtistId: 'rk-1', name: 'NonexistentBand' }
    const result = await reconcileArtist(artist, 'plex', ctx)
    expect(result.mbid).toBeNull()
    expect(result.unreconciledReason).toBe('no_candidate')
    expect(ctx.counts.unreconciledNoCandidate).toBe(1)
  })

  it('drops MB candidates whose normalized name does not equal the query', async () => {
    const ctx = makeCtx({
      mbClient: {
        // MB returns "Bush III" which normalizes differently from "Bush"
        searchArtist: vi.fn().mockResolvedValue({
          artists: [{ id: VALID_MBID, name: 'Bush III', score: 100 }],
        }),
        getReleaseGroups: vi.fn(),
      },
    })
    const artist: LibraryArtist = { sourceArtistId: 'rk-1', name: 'Bush' }
    const result = await reconcileArtist(artist, 'plex', ctx)
    expect(result.mbid).toBeNull()
    expect(result.unreconciledReason).toBe('no_candidate')
  })
})

describe('reconcileArtist -- Step 3 (anchoring)', () => {
  it('anchors when MB returns multiple candidates and one matches knownMbids', async () => {
    const ctx = makeCtx({
      knownMbids: new Set([VALID_MBID]),
      mbClient: {
        searchArtist: vi.fn().mockResolvedValue({
          artists: [
            { id: VALID_MBID, name: 'Bush', score: 100 },
            { id: OTHER_MBID, name: 'Bush', score: 90 },
          ],
        }),
        getReleaseGroups: vi.fn(),
      },
    })
    const artist: LibraryArtist = { sourceArtistId: 'rk-1', name: 'Bush' }
    const result = await reconcileArtist(artist, 'plex', ctx)
    expect(result.mbid).toBe(VALID_MBID)
    expect(result.matchMethod).toBe('name_anchored')
    expect(result.matchConfidence).toBe(0.85)
    expect(ctx.counts.matchedNameAnchored).toBe(1)
  })

  it('does not anchor when zero candidates match knownMbids', async () => {
    const ctx = makeCtx({
      knownMbids: new Set(['other-mbid-not-matching']),
      mbClient: {
        searchArtist: vi.fn().mockResolvedValue({
          artists: [
            { id: VALID_MBID, name: 'Bush', score: 100 },
            { id: OTHER_MBID, name: 'Bush', score: 90 },
          ],
        }),
        getReleaseGroups: vi.fn().mockResolvedValue([]),
      },
    })
    const artist: LibraryArtist = { sourceArtistId: 'rk-1', name: 'Bush' }
    const result = await reconcileArtist(artist, 'plex', ctx)
    // Will fall through to Step 5 disambiguation in Task 10. For now (Task 9),
    // since there's no album data, expect "ambiguous" -- Task 10 may rewrite this.
    expect(result.matchMethod).toBeNull()
    expect(result.unreconciledReason).toBe('ambiguous')
  })

  it('falls through to ambiguous when 2+ candidates match knownMbids', async () => {
    const ctx = makeCtx({
      knownMbids: new Set([VALID_MBID, OTHER_MBID]),
      mbClient: {
        searchArtist: vi.fn().mockResolvedValue({
          artists: [
            { id: VALID_MBID, name: 'Bush', score: 100 },
            { id: OTHER_MBID, name: 'Bush', score: 90 },
          ],
        }),
        getReleaseGroups: vi.fn().mockResolvedValue([]),
      },
    })
    const artist: LibraryArtist = { sourceArtistId: 'rk-1', name: 'Bush' }
    const result = await reconcileArtist(artist, 'plex', ctx)
    expect(result.matchMethod).toBeNull()
    expect(result.unreconciledReason).toBe('ambiguous')
  })
})

describe('reconcileArtist -- Step 5 (album-overlap disambiguation)', () => {
  it('picks winner when album overlap is clear', async () => {
    const ctx = makeCtx({
      mbClient: {
        searchArtist: vi.fn().mockResolvedValue({
          artists: [
            { id: VALID_MBID, name: 'Bush', score: 100 },
            { id: OTHER_MBID, name: 'Bush', score: 90 },
          ],
        }),
        getReleaseGroups: vi.fn().mockImplementation((mbid: string) => {
          if (mbid === VALID_MBID) {
            return Promise.resolve([
              { id: 'rg1', title: 'Sixteen Stone', type: 'Album' },
              { id: 'rg2', title: 'Razorblade Suitcase', type: 'Album' },
              { id: 'rg3', title: 'The Science of Things', type: 'Album' },
            ])
          }
          return Promise.resolve([{ id: 'rg9', title: 'Korean Album', type: 'Album' }])
        }),
      },
    })
    const artist: LibraryArtist = {
      sourceArtistId: 'rk-1',
      name: 'Bush',
      knownAlbumTitles: ['Sixteen Stone', 'Razorblade Suitcase'],
    }
    const result = await reconcileArtist(artist, 'plex', ctx)
    expect(result.mbid).toBe(VALID_MBID)
    expect(result.matchMethod).toBe('name_disambiguated')
    expect(result.matchConfidence).toBe(0.5)
    expect(ctx.counts.matchedDisambiguated).toBe(1)
  })

  it('returns ambiguous when no album data is available', async () => {
    const ctx = makeCtx({
      mbClient: {
        searchArtist: vi.fn().mockResolvedValue({
          artists: [
            { id: VALID_MBID, name: 'Bush', score: 100 },
            { id: OTHER_MBID, name: 'Bush', score: 90 },
          ],
        }),
        getReleaseGroups: vi.fn(),
      },
    })
    const artist: LibraryArtist = {
      sourceArtistId: 'rk-1',
      name: 'Bush',
      knownAlbumTitles: [],
    }
    const result = await reconcileArtist(artist, 'plex', ctx)
    expect(result.matchMethod).toBeNull()
    expect(result.unreconciledReason).toBe('ambiguous')
    expect(ctx.mbClient.getReleaseGroups).not.toHaveBeenCalled()
  })

  it('returns ambiguous when overlap is not 2x runner-up', async () => {
    const ctx = makeCtx({
      mbClient: {
        searchArtist: vi.fn().mockResolvedValue({
          artists: [
            { id: VALID_MBID, name: 'Bush', score: 100 },
            { id: OTHER_MBID, name: 'Bush', score: 90 },
          ],
        }),
        getReleaseGroups: vi.fn().mockImplementation((mbid: string) => {
          if (mbid === VALID_MBID) {
            return Promise.resolve([
              { id: 'rg1', title: 'Album One', type: 'Album' },
              { id: 'rg2', title: 'Album Two', type: 'Album' },
            ])
          }
          return Promise.resolve([
            { id: 'rg3', title: 'Album One', type: 'Album' },
            { id: 'rg4', title: 'Album Two', type: 'Album' },
          ])
        }),
      },
    })
    const artist: LibraryArtist = {
      sourceArtistId: 'rk-1',
      name: 'Bush',
      knownAlbumTitles: ['Album One', 'Album Two'],
    }
    const result = await reconcileArtist(artist, 'plex', ctx)
    expect(result.matchMethod).toBeNull()
    expect(result.unreconciledReason).toBe('ambiguous')
  })

  it('returns ambiguous when winner has fewer than 2 overlaps', async () => {
    const ctx = makeCtx({
      mbClient: {
        searchArtist: vi.fn().mockResolvedValue({
          artists: [
            { id: VALID_MBID, name: 'Bush', score: 100 },
            { id: OTHER_MBID, name: 'Bush', score: 90 },
          ],
        }),
        getReleaseGroups: vi
          .fn()
          .mockResolvedValue([{ id: 'rg1', title: 'Only One', type: 'Album' }]),
      },
    })
    const artist: LibraryArtist = {
      sourceArtistId: 'rk-1',
      name: 'Bush',
      knownAlbumTitles: ['Only One'],
    }
    const result = await reconcileArtist(artist, 'plex', ctx)
    expect(result.unreconciledReason).toBe('ambiguous')
  })
})
