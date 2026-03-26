// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import { enrichSearchResultsWithImages } from '@/core/search/enrich'
import type { MergedSearchResult } from '@/core/search/multi-source'

function makeResult(overrides: Partial<MergedSearchResult> = {}): MergedSearchResult {
  return {
    name: 'Scorpions',
    mbid: 'mbid-1',
    images: [],
    genres: [],
    sources: [{ id: 'musicbrainz' }],
    inLibrary: false,
    inRecommendations: false,
    ...overrides,
  }
}

describe('enrichSearchResultsWithImages', () => {
  it('uses cached images before falling back to Lidarr', async () => {
    const lookupLidarrImage = vi.fn().mockResolvedValue(undefined)

    const results = await enrichSearchResultsWithImages([makeResult()], {
      getCachedImages: async () => new Map([['mbid-1', 'https://img.example/cache.jpg']]),
      lookupLidarrImage,
    })

    expect(results[0]?.images).toEqual([{ url: 'https://img.example/cache.jpg', source: 'cache' }])
    expect(lookupLidarrImage).not.toHaveBeenCalled()
  })

  it('uses Lidarr when the cache is empty and stores the result', async () => {
    const cacheImage = vi.fn().mockResolvedValue(undefined)

    const results = await enrichSearchResultsWithImages([makeResult()], {
      getCachedImages: async () => new Map(),
      lookupLidarrImage: async () => 'https://img.example/lidarr.jpg',
      cacheImage,
    })

    expect(results[0]?.images).toEqual([
      { url: 'https://img.example/lidarr.jpg', source: 'lidarr' },
    ])
    expect(cacheImage).toHaveBeenCalledWith('mbid-1', 'https://img.example/lidarr.jpg')
  })

  it('leaves existing images untouched', async () => {
    const existing = makeResult({
      images: [{ url: 'https://img.example/existing.jpg', source: 'deezer' }],
    })

    const results = await enrichSearchResultsWithImages([existing], {
      getCachedImages: async () => new Map(),
      lookupLidarrImage: async () => 'https://img.example/lidarr.jpg',
    })

    expect(results[0]?.images).toEqual([
      { url: 'https://img.example/existing.jpg', source: 'deezer' },
    ])
  })

  it('keeps search results when Lidarr lookup fails', async () => {
    const results = await enrichSearchResultsWithImages([makeResult()], {
      getCachedImages: async () => new Map(),
      lookupLidarrImage: async () => {
        throw new Error('skyhook unavailable')
      },
    })

    expect(results[0]?.name).toBe('Scorpions')
    expect(results[0]?.images).toEqual([])
  })

  it('keeps search results when image cache persistence fails', async () => {
    const results = await enrichSearchResultsWithImages([makeResult()], {
      getCachedImages: async () => new Map(),
      lookupLidarrImage: async () => 'https://img.example/lidarr.jpg',
      cacheImage: async () => {
        throw new Error('db unavailable')
      },
    })

    expect(results[0]?.images).toEqual([
      { url: 'https://img.example/lidarr.jpg', source: 'lidarr' },
    ])
  })
})
