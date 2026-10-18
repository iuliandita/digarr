// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { PipelineCancelledError } from '@/core/pipeline/cancel'
import { store } from '@/core/pipeline/store'
import type { ScoredArtist } from '@/core/types'

function makeArtist(mbid: string, score = 0.75): ScoredArtist {
  return {
    mbid,
    name: `Artist ${mbid}`,
    tags: ['rock'],
    genres: ['rock'],
    streamingUrls: { spotify: `https://open.spotify.com/artist/${mbid}` },
    discoveries: [{ name: `Artist ${mbid}`, similarityScore: 0.8, source: 'listenbrainz' }],
    score,
    sourceScores: {
      consensus: 0.5,
      similarity: 0.8,
      genreOverlap: 0.6,
      aiConfidence: 0.5,
      feedbackBoost: 0.5,
    },
    aiReasoning: undefined,
  }
}

function makeDb(batchId = 1, artistIdCounter = { value: 100 }) {
  return {
    getExistingRecommendationMbids: vi.fn().mockResolvedValue(new Set()),
    insertBatch: vi.fn().mockImplementation(async () => ({ id: batchId })),
    completeBatch: vi.fn().mockResolvedValue(undefined),
    failBatch: vi.fn().mockResolvedValue(undefined),
    upsertArtist: vi.fn().mockImplementation(async () => ({ id: artistIdCounter.value++ })),
    insertRecommendation: vi.fn().mockResolvedValue(undefined),
    getRejectedMbids: vi.fn().mockResolvedValue(new Set()),
    getBlockedMbids: vi.fn().mockResolvedValue(new Set()),
    getFeedbackHistory: vi.fn().mockResolvedValue(new Map()),
  }
}

describe('store()', () => {
  it('creates a batch row and returns its ID', async () => {
    const db = makeDb(42)
    const batchId = await store([], db)

    expect(db.insertBatch).toHaveBeenCalledOnce()
    expect(batchId).toBe(42)
  })

  it('upserts each artist and links a pending recommendation to the batch', async () => {
    const artist: ScoredArtist = {
      ...makeArtist('mbid-full'),
      name: 'Full Artist',
      disambiguation: 'the band',
      imageUrl: 'https://example.com/img.jpg',
      aiReasoning: 'Strong genre match with your library',
    }
    const db = makeDb(7, { value: 99 })

    await store([artist, makeArtist('mbid-b')], db)

    expect(db.upsertArtist).toHaveBeenCalledTimes(2)
    expect(db.upsertArtist).toHaveBeenCalledWith({
      mbid: 'mbid-full',
      name: 'Full Artist',
      disambiguation: 'the band',
      tags: artist.tags,
      genres: artist.genres,
      imageUrl: 'https://example.com/img.jpg',
      streamingUrls: artist.streamingUrls,
    })
    expect(db.insertRecommendation).toHaveBeenCalledTimes(2)
    expect(db.insertRecommendation).toHaveBeenCalledWith(
      expect.objectContaining({
        batchId: 7,
        artistId: 99,
        score: artist.score,
        status: 'pending',
        kind: 'artist',
        sources: artist.sourceScores,
        aiReasoning: 'Strong genre match with your library',
      }),
    )
  })

  it('persists kind=album for album-kind candidates', async () => {
    const db = makeDb()
    const artist = {
      ...makeArtist('mbid-album'),
      kind: 'album' as const,
      releaseGroupMbid: 'rg-1',
      suggestedAlbum: { releaseGroupId: 'rg-1', title: 'In Rainbows' },
    }

    await store([artist] as never, db)

    expect(db.insertRecommendation).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'album', recommendedReleaseGroupId: 'rg-1' }),
    )
  })

  it('handles empty artists array - creates batch with no recommendations', async () => {
    const db = makeDb(5)

    const batchId = await store([], db)

    expect(batchId).toBe(5)
    expect(db.insertBatch).toHaveBeenCalledOnce()
    expect(db.upsertArtist).not.toHaveBeenCalled()
    expect(db.insertRecommendation).not.toHaveBeenCalled()
  })

  it('calls completeBatch with real stats on success', async () => {
    const db = makeDb(1)
    await store([makeArtist('a'), makeArtist('b'), makeArtist('c')], db)

    expect(db.completeBatch).toHaveBeenCalledOnce()
    expect(db.completeBatch).toHaveBeenCalledWith(1, {
      discovered: 3,
      added: 3,
      failed: 0,
    })
  })

  it('counts failures when upsertArtist throws', async () => {
    const db = makeDb(1)
    db.upsertArtist
      .mockResolvedValueOnce({ id: 100 }) // first succeeds
      .mockRejectedValueOnce(new Error('db error')) // second fails
      .mockResolvedValueOnce({ id: 101 }) // third succeeds

    await store([makeArtist('ok-1'), makeArtist('fail'), makeArtist('ok-2')], db)

    expect(db.completeBatch).toHaveBeenCalledWith(1, {
      discovered: 3,
      added: 2,
      failed: 1,
    })
    // The failed artist should not have a recommendation inserted
    expect(db.insertRecommendation).toHaveBeenCalledTimes(2)
  })

  it('marks the batch failed and rethrows when completeBatch throws', async () => {
    const db = makeDb(42)
    db.completeBatch.mockRejectedValueOnce(new Error('db down'))

    await expect(store([makeArtist('a')], db)).rejects.toThrow('db down')
    expect(db.failBatch).toHaveBeenCalledWith(42)
  })

  it('does not call failBatch on the success path', async () => {
    const db = makeDb(7)
    await store([makeArtist('a')], db)
    expect(db.failBatch).not.toHaveBeenCalled()
  })

  it('calls completeBatch with zeros for empty artist list', async () => {
    const db = makeDb(5)
    await store([], db)

    expect(db.completeBatch).toHaveBeenCalledWith(5, {
      discovered: 0,
      added: 0,
      failed: 0,
    })
  })

  it.each([[42], [undefined]])(
    'passes subscriptionId %s to insertBatch',
    async (subscriptionId) => {
      const db = makeDb()
      await store([makeArtist('mbid-sub')], db, subscriptionId ? { subscriptionId } : undefined)
      expect(db.insertBatch).toHaveBeenCalledWith(expect.objectContaining({ subscriptionId }))
    },
  )

  it.each([false, true])(
    'drains the current write unit and stops before the next artist (atomic=%s)',
    async (atomic) => {
      const controller = new AbortController()
      const db = makeDb()
      const write = vi.fn(async () => {
        controller.abort()
      })
      if (atomic) Object.assign(db, { upsertArtistAndRecommendation: write })
      else
        db.upsertArtist.mockImplementationOnce(async () => {
          controller.abort()
          return { id: 100 }
        })
      await expect(
        store([makeArtist('a'), makeArtist('b')], db, { signal: controller.signal }),
      ).rejects.toBeInstanceOf(PipelineCancelledError)
      expect(atomic ? write : db.insertRecommendation).toHaveBeenCalledOnce()
      expect(db.completeBatch).not.toHaveBeenCalled()
      expect(db.failBatch).toHaveBeenCalledWith(1)
    },
  )

  it('preserves the original completion failure when batch cleanup also fails', async () => {
    const db = makeDb()
    db.completeBatch.mockRejectedValueOnce(new Error('primary failure'))
    db.failBatch.mockRejectedValueOnce(new Error('cleanup failure'))
    await expect(store([], db)).rejects.toThrow('primary failure')
  })
  it('does not create a batch when cancellation was already accepted', async () => {
    const db = makeDb()
    const controller = new AbortController()
    controller.abort()
    await expect(store([], db, { signal: controller.signal })).rejects.toBeInstanceOf(
      PipelineCancelledError,
    )
    expect(db.insertBatch).not.toHaveBeenCalled()
  })

  it('reports failed cancellation cleanup as a real error with both causes', async () => {
    const db = makeDb()
    const controller = new AbortController()
    db.upsertArtist.mockImplementationOnce(async () => {
      controller.abort()
      return { id: 1 }
    })
    const cleanupError = new Error('batch cleanup failed')
    db.failBatch.mockRejectedValueOnce(cleanupError)
    await expect(store([makeArtist('a')], db, { signal: controller.signal })).rejects.toMatchObject(
      { errors: [expect.any(PipelineCancelledError), cleanupError] },
    )
    expect(db.completeBatch).not.toHaveBeenCalled()
  })
})
