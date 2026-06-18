// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { enrichGenres, type MetadataLookup } from '@/core/pipeline/enrich'
import type { ResolvedArtist } from '@/core/types'

function makeArtist(overrides: Partial<ResolvedArtist> = {}): ResolvedArtist {
  return {
    mbid: 'mbid-test',
    name: 'Test Artist',
    tags: [],
    genres: [],
    streamingUrls: {},
    discoveries: [],
    ...overrides,
  }
}

describe('enrichGenres()', () => {
  it('fills empty MB genres with Spotify genres', async () => {
    const lookup: MetadataLookup = vi.fn().mockResolvedValue({
      spotifyGenres: ['indie rock', 'shoegaze'],
      spotifyPopularity: 75,
    })
    const artists = [makeArtist({ genres: [], tags: [] })]
    const result = await enrichGenres(artists, lookup)
    expect(result[0]?.genres).toEqual(['indie rock', 'shoegaze'])
  })

  it('merges Spotify genres with sparse MB genres without duplicates', async () => {
    const lookup: MetadataLookup = vi.fn().mockResolvedValue({
      spotifyGenres: ['rock', 'shoegaze', 'dream pop'],
      spotifyPopularity: 60,
    })
    const artists = [makeArtist({ genres: ['Rock'], tags: ['Rock'] })]
    const result = await enrichGenres(artists, lookup)
    // 'Rock' (MB) kept, 'rock' (Spotify) skipped as dupe, shoegaze + dream pop added
    expect(result[0]?.genres).toEqual(['Rock', 'shoegaze', 'dream pop'])
  })

  it('leaves artists with 3+ MB genres unchanged', async () => {
    const lookup: MetadataLookup = vi.fn()
    const artists = [makeArtist({ genres: ['rock', 'pop', 'electronic'] })]
    const result = await enrichGenres(artists, lookup)
    expect(result[0]?.genres).toEqual(['rock', 'pop', 'electronic'])
    expect(lookup).not.toHaveBeenCalled()
  })

  it('leaves artist unchanged when not found in metadata', async () => {
    const lookup: MetadataLookup = vi.fn().mockResolvedValue(null)
    const artists = [makeArtist({ genres: ['rock'] })]
    const result = await enrichGenres(artists, lookup)
    expect(result[0]?.genres).toEqual(['rock'])
  })

  it('returns artists unchanged when lookup is null', async () => {
    const artists = [makeArtist({ genres: ['rock'] })]
    const result = await enrichGenres(artists, null)
    expect(result[0]?.genres).toEqual(['rock'])
  })

  it('handles metadata with empty spotifyGenres', async () => {
    const lookup: MetadataLookup = vi.fn().mockResolvedValue({
      spotifyGenres: [],
      spotifyPopularity: 50,
    })
    const artists = [makeArtist({ genres: ['rock'] })]
    const result = await enrichGenres(artists, lookup)
    expect(result[0]?.genres).toEqual(['rock'])
  })

  it('returns artist unchanged when lookup throws, without aborting the batch', async () => {
    const lookup: MetadataLookup = vi
      .fn()
      .mockRejectedValueOnce(new Error('DB connection lost'))
      .mockResolvedValueOnce({ spotifyGenres: ['jazz'], spotifyPopularity: 70 })
    const artists = [
      makeArtist({ name: 'Failing Artist', genres: ['rock'] }),
      makeArtist({ name: 'OK Artist', genres: ['pop'] }),
    ]
    const result = await enrichGenres(artists, lookup)
    expect(result[0]?.genres).toEqual(['rock'])
    expect(result[1]?.genres).toEqual(['pop', 'jazz'])
  })
})
