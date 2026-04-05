// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { SearchResult, SearchSource } from '@/core/search/multi-source'
import { multiSourceSearch } from '@/core/search/multi-source'

function makeSource(id: string, results: SearchResult[] = [], shouldFail = false): SearchSource {
  return {
    id,
    name: id,
    available: true,
    search: shouldFail
      ? vi.fn().mockRejectedValue(new Error(`${id} is down`))
      : vi.fn().mockResolvedValue(results),
  }
}

describe('multiSourceSearch resilience', () => {
  it('returns results from healthy sources when one source fails', async () => {
    const sources = [
      makeSource('spotify', [], true),
      makeSource('musicbrainz', [
        { name: 'Radiohead', mbid: 'abc', images: [], genres: ['rock'], sourceId: 'musicbrainz' },
      ]),
      makeSource('deezer', [
        { name: 'Radiohead', mbid: 'abc', images: [], genres: [], sourceId: 'deezer' },
      ]),
    ]

    const results = await multiSourceSearch('radiohead', sources)
    expect(results.length).toBeGreaterThan(0)
  })

  it('returns empty when all sources fail', async () => {
    const sources = [makeSource('spotify', [], true), makeSource('musicbrainz', [], true)]

    const results = await multiSourceSearch('anything', sources)
    expect(results).toHaveLength(0)
  })

  it('returns results when only one source is available', async () => {
    const sources = [
      makeSource('musicbrainz', [
        { name: 'Bjork', mbid: 'def', images: [], genres: ['electronic'], sourceId: 'musicbrainz' },
      ]),
    ]

    const results = await multiSourceSearch('bjork', sources)
    expect(results).toHaveLength(1)
  })
})
