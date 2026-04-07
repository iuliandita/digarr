// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import { type ReconcilerContext, reconcileArtist } from '@/core/library/reconciler'
import { createLidarrLibrarySource } from '@/core/library/sources/lidarr'
import fixture from '../../fixtures/lidarr-only-recommendations.json'

function makeCtx(overrides: Partial<ReconcilerContext> = {}): ReconcilerContext {
  return {
    userId: null,
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

describe('Lidarr-only regression baseline', () => {
  it('reconciler maps every Lidarr artist to its source MBID', async () => {
    const client = {
      getArtists: vi.fn().mockResolvedValue(fixture.lidarrArtists),
      testConnection: vi.fn(),
    }
    const source = createLidarrLibrarySource(client as never)
    const artists = await source.listArtists()

    expect(artists).toHaveLength(fixture.lidarrArtists.length)

    const reconciled = await Promise.all(
      artists.map((artist) => reconcileArtist(artist, 'lidarr', makeCtx())),
    )

    expect(reconciled.map((row) => row.mbid).sort()).toEqual(
      [...fixture.expectedLibraryMbids].sort(),
    )
  })

  it('library genres union matches the expected baseline', async () => {
    const client = {
      getArtists: vi.fn().mockResolvedValue(fixture.lidarrArtists),
      testConnection: vi.fn(),
    }
    const source = createLidarrLibrarySource(client as never)
    const artists = await source.listArtists()
    const allGenres = new Set<string>()

    for (const artist of artists) {
      for (const genre of artist.genres ?? []) {
        allGenres.add(genre)
      }
    }

    expect([...allGenres].sort()).toEqual([...fixture.expectedLibraryGenres].sort())
  })
})
