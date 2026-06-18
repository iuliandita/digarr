// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock DB queries
const mockGetCached = vi.fn()
const mockInsertCached = vi.fn()

vi.mock('@/db/queries/recording-artist-cache', () => ({
  getCachedRecordingArtists: (...args: unknown[]) => mockGetCached(...args),
  insertCachedRecordingArtists: (...args: unknown[]) => mockInsertCached(...args),
}))

import type { TagRadioRecording } from '@/core/clients/listenbrainz'
import { resolveTagRadioRecordings } from '@/core/clients/tag-radio-resolver'
import type { Database } from '@/db'

const mockLookupRecording = vi.fn()
const mockMbClient = {
  lookupRecording: mockLookupRecording,
}
const mockDb = {} as Database

beforeEach(() => {
  vi.clearAllMocks()
  mockGetCached.mockResolvedValue([])
  mockInsertCached.mockResolvedValue(undefined)
})

describe('resolveTagRadioRecordings', () => {
  it('resolves recordings to artists via MB lookups on cache miss', async () => {
    const recordings: TagRadioRecording[] = [
      { recordingMbid: 'rec-1', percent: 100, source: 'artist', tagCount: 5 },
      { recordingMbid: 'rec-2', percent: 60, source: 'artist', tagCount: 3 },
    ]

    mockLookupRecording
      .mockResolvedValueOnce({
        recordingMbid: 'rec-1',
        artistMbid: 'artist-A',
        artistName: 'Artist A',
      })
      .mockResolvedValueOnce({
        recordingMbid: 'rec-2',
        artistMbid: 'artist-B',
        artistName: 'Artist B',
      })

    const result = await resolveTagRadioRecordings(recordings, mockMbClient, mockDb)

    expect(result).toEqual([
      { artistMbid: 'artist-A', artistName: 'Artist A', score: 1.0 },
      { artistMbid: 'artist-B', artistName: 'Artist B', score: 0.6 },
    ])
    expect(mockInsertCached).toHaveBeenCalledOnce()
  })

  it('uses cache hits and skips MB lookups for cached recordings', async () => {
    mockGetCached.mockResolvedValue([
      {
        recordingMbid: 'rec-1',
        artistMbid: 'artist-A',
        artistName: 'Artist A',
        cachedAt: new Date(),
      },
    ])

    const recordings: TagRadioRecording[] = [
      { recordingMbid: 'rec-1', percent: 80, source: 'artist', tagCount: 5 },
      { recordingMbid: 'rec-2', percent: 50, source: 'artist', tagCount: 3 },
    ]

    mockLookupRecording.mockResolvedValueOnce({
      recordingMbid: 'rec-2',
      artistMbid: 'artist-B',
      artistName: 'Artist B',
    })

    const result = await resolveTagRadioRecordings(recordings, mockMbClient, mockDb)

    // Only 1 MB lookup (rec-2), rec-1 was cached
    expect(mockLookupRecording).toHaveBeenCalledTimes(1)
    expect(mockLookupRecording).toHaveBeenCalledWith('rec-2')
    expect(result).toHaveLength(2)
  })

  it('groups multiple recordings by artist and takes max percent', async () => {
    const recordings: TagRadioRecording[] = [
      { recordingMbid: 'rec-1', percent: 40, source: 'artist', tagCount: 5 },
      { recordingMbid: 'rec-2', percent: 90, source: 'artist', tagCount: 3 },
      { recordingMbid: 'rec-3', percent: 70, source: 'artist', tagCount: 4 },
    ]

    // rec-1 and rec-2 both belong to Artist A, rec-3 belongs to Artist B
    mockLookupRecording
      .mockResolvedValueOnce({
        recordingMbid: 'rec-1',
        artistMbid: 'artist-A',
        artistName: 'Artist A',
      })
      .mockResolvedValueOnce({
        recordingMbid: 'rec-2',
        artistMbid: 'artist-A',
        artistName: 'Artist A',
      })
      .mockResolvedValueOnce({
        recordingMbid: 'rec-3',
        artistMbid: 'artist-B',
        artistName: 'Artist B',
      })

    const result = await resolveTagRadioRecordings(recordings, mockMbClient, mockDb)

    expect(result).toEqual([
      { artistMbid: 'artist-A', artistName: 'Artist A', score: 0.9 }, // max(40, 90) / 100
      { artistMbid: 'artist-B', artistName: 'Artist B', score: 0.7 },
    ])
  })

  it('drops recordings that return null from MB (404)', async () => {
    const recordings: TagRadioRecording[] = [
      { recordingMbid: 'rec-1', percent: 100, source: 'artist', tagCount: 5 },
      { recordingMbid: 'rec-gone', percent: 80, source: 'artist', tagCount: 3 },
    ]

    mockLookupRecording
      .mockResolvedValueOnce({
        recordingMbid: 'rec-1',
        artistMbid: 'artist-A',
        artistName: 'Artist A',
      })
      .mockResolvedValueOnce(null) // 404

    const result = await resolveTagRadioRecordings(recordings, mockMbClient, mockDb)

    expect(result).toHaveLength(1)
    expect(result[0]?.artistMbid).toBe('artist-A')
  })

  it('returns empty array for empty input', async () => {
    const result = await resolveTagRadioRecordings([], mockMbClient, mockDb)
    expect(result).toEqual([])
  })

  it('sorts results by score descending', async () => {
    const recordings: TagRadioRecording[] = [
      { recordingMbid: 'rec-1', percent: 30, source: 'artist', tagCount: 5 },
      { recordingMbid: 'rec-2', percent: 90, source: 'artist', tagCount: 3 },
      { recordingMbid: 'rec-3', percent: 60, source: 'artist', tagCount: 4 },
    ]

    mockLookupRecording
      .mockResolvedValueOnce({ recordingMbid: 'rec-1', artistMbid: 'artist-A', artistName: 'A' })
      .mockResolvedValueOnce({ recordingMbid: 'rec-2', artistMbid: 'artist-B', artistName: 'B' })
      .mockResolvedValueOnce({ recordingMbid: 'rec-3', artistMbid: 'artist-C', artistName: 'C' })

    const result = await resolveTagRadioRecordings(recordings, mockMbClient, mockDb)

    expect(result[0]?.score).toBe(0.9)
    expect(result[1]?.score).toBe(0.6)
    expect(result[2]?.score).toBe(0.3)
  })

  it('continues resolving remaining recordings when one lookup throws', async () => {
    const recordings: TagRadioRecording[] = [
      { recordingMbid: 'rec-1', percent: 80, source: 'artist', tagCount: 5 },
      { recordingMbid: 'rec-2', percent: 60, source: 'artist', tagCount: 3 },
    ]

    mockLookupRecording.mockRejectedValueOnce(new Error('MB 503')).mockResolvedValueOnce({
      recordingMbid: 'rec-2',
      artistMbid: 'artist-B',
      artistName: 'Artist B',
    })

    const result = await resolveTagRadioRecordings(recordings, mockMbClient, mockDb)

    expect(mockLookupRecording).toHaveBeenCalledTimes(2)
    expect(result).toHaveLength(1)
    expect(result[0]?.artistMbid).toBe('artist-B')
  })
})
