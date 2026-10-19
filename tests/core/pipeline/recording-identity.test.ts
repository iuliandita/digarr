// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockResolve = vi.fn()
vi.mock('@/core/clients/listenbrainz', () => ({
  createListenBrainzClient: vi.fn(() => ({ getTagRadio: vi.fn().mockResolvedValue([]) })),
}))
vi.mock('@/core/clients/tag-radio-resolver', () => ({
  resolveTagRadioRecordings: (...args: unknown[]) => mockResolve(...args),
}))
vi.mock('@/core/discovery-modes/modes/runtime', () => ({
  getDiscoveryModeConnections: vi.fn().mockResolvedValue({
    listenbrainzUsername: 'user',
    listenbrainzToken: 'token',
  }),
  getNormalizedLimit: vi.fn((_req: unknown, fallback: number) => fallback),
  normalizeDiscoveryName: vi.fn((name: string) => name.toLowerCase()),
}))
vi.mock('@/db', () => ({ db: {} }))

import type { MBArtist } from '@/core/clients/musicbrainz'
import {
  discoveryCandidatesToDiscoveredArtists,
  normalizeDiscoveryCandidates,
} from '@/core/discovery-modes/candidates'
import { createListenBrainzTagRadioMode } from '@/core/discovery-modes/modes/listenbrainz'
import type { DiscoveryModeRequest } from '@/core/discovery-modes/request'
import { resolve } from '@/core/pipeline/resolve'
import { store } from '@/core/pipeline/store'
import type { DiscoveredArtist } from '@/core/types'

const ARTIST = '8f6bd1e4-fbe1-4f50-aa9b-94c450ec0f11'
const RECORDING = 'e8f9b188-f819-4e43-ab0f-4bd26ce9ff56'

function makeMb(artist: Partial<MBArtist>) {
  return {
    lookupArtist: vi.fn().mockResolvedValue({ tags: [], relations: [], ...artist }),
    searchArtist: vi
      .fn()
      .mockResolvedValue({ artists: [{ id: artist.id, name: artist.name, score: 100 }] }),
    extractStreamingUrls: vi.fn().mockReturnValue({}),
  }
}

function resolveWith(discovered: DiscoveredArtist[], mb: ReturnType<typeof makeMb>) {
  return resolve(discovered, mb as never, undefined, null, null, null, undefined, null, false)
}

function makeStoreDb() {
  return {
    getExistingRecommendationMbids: vi.fn().mockResolvedValue(new Set()),
    insertBatch: vi.fn().mockResolvedValue({ id: 1 }),
    completeBatch: vi.fn().mockResolvedValue(undefined),
    failBatch: vi.fn().mockResolvedValue(undefined),
    upsertArtist: vi.fn().mockResolvedValue({ id: 10 }),
    insertRecommendation: vi.fn().mockResolvedValue(undefined),
    getRejectedMbids: vi.fn().mockResolvedValue(new Set()),
    getBlockedMbids: vi.fn().mockResolvedValue(new Set()),
    getFeedbackHistory: vi.fn().mockResolvedValue(new Map()),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('recording identity from ListenBrainz to storage', () => {
  it('stores the tag radio recording unchanged on the recommendation', async () => {
    mockResolve.mockResolvedValueOnce([
      {
        artistMbid: ARTIST,
        artistName: 'Portishead',
        score: 0.9,
        recordingMbid: RECORDING.toUpperCase(),
        recordingTitle: 'Roads',
      },
    ])
    const raw = await createListenBrainzTagRadioMode().executor({
      modeId: 'lb-tag-radio',
      userId: 1,
      normalizedSettings: { tags: [{ tag: 'trip hop', weight: 1 }] },
    } as unknown as DiscoveryModeRequest)
    const discovered = discoveryCandidatesToDiscoveredArtists(
      normalizeDiscoveryCandidates(raw.candidates, 'lb-tag-radio'),
    )

    const [resolved] = await resolveWith(discovered, makeMb({ id: ARTIST, name: 'Portishead' }))
    expect(resolved?.suggestedRecording).toEqual({ mbid: RECORDING, title: 'Roads' })

    const db = makeStoreDb()
    if (!resolved) throw new Error('not resolved')
    await store([{ ...resolved, score: 0.9, sourceScores: {} }], db, { userId: 1 })
    expect(db.insertRecommendation).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'artist',
        recommendedRecordingMbid: RECORDING,
        recommendedRecordingTitle: 'Roads',
      }),
    )
  })

  it('drops the recording when the artist only resolved by name', async () => {
    const discovered: DiscoveredArtist[] = [
      {
        name: 'Nirvana',
        similarityScore: 0.8,
        source: 'lb-tag-radio',
        recordingMbid: RECORDING,
        recordingTitle: 'Lithium',
      },
    ]
    const [resolved] = await resolveWith(discovered, makeMb({ id: ARTIST, name: 'Nirvana' }))
    expect(resolved?.mbid).toBe(ARTIST)
    expect(resolved?.suggestedRecording).toBeUndefined()
  })
})
