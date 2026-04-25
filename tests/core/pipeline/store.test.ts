// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
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

  it('upserts an artist row for each scored artist', async () => {
    const artists = [makeArtist('mbid-a'), makeArtist('mbid-b')]
    const db = makeDb()

    await store(artists, db)

    expect(db.upsertArtist).toHaveBeenCalledTimes(2)
    expect(db.upsertArtist).toHaveBeenCalledWith(expect.objectContaining({ mbid: 'mbid-a' }))
    expect(db.upsertArtist).toHaveBeenCalledWith(expect.objectContaining({ mbid: 'mbid-b' }))
  })

  it('creates a recommendation row for each artist linked to the batch', async () => {
    const artists = [makeArtist('mbid-a')]
    const db = makeDb(7, { value: 99 })

    await store(artists, db)

    expect(db.insertRecommendation).toHaveBeenCalledOnce()
    expect(db.insertRecommendation).toHaveBeenCalledWith(
      expect.objectContaining({
        batchId: 7,
        artistId: 99,
        score: artists[0]?.score,
        status: 'pending',
      }),
    )
  })

  it('passes sourceScores as sources to insertRecommendation', async () => {
    const artist = makeArtist('mbid-a')
    const db = makeDb()

    await store([artist], db)

    expect(db.insertRecommendation).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: artist.sourceScores,
      }),
    )
  })

  it('passes aiReasoning to insertRecommendation when present', async () => {
    const artist: ScoredArtist = {
      ...makeArtist('mbid-ai'),
      aiReasoning: 'Strong genre match with your library',
    }
    const db = makeDb()

    await store([artist], db)

    expect(db.insertRecommendation).toHaveBeenCalledWith(
      expect.objectContaining({
        aiReasoning: 'Strong genre match with your library',
      }),
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

  it('calls completeBatch with zeros for empty artist list', async () => {
    const db = makeDb(5)
    await store([], db)

    expect(db.completeBatch).toHaveBeenCalledWith(5, {
      discovered: 0,
      added: 0,
      failed: 0,
    })
  })

  it('passes subscriptionId to insertBatch', async () => {
    const db = makeDb()
    await store([makeArtist('mbid-sub')], db, { subscriptionId: 42 })
    expect(db.insertBatch).toHaveBeenCalledWith(expect.objectContaining({ subscriptionId: 42 }))
  })

  it('passes undefined subscriptionId when not provided', async () => {
    const db = makeDb()
    await store([makeArtist('mbid-nosub')], db)
    expect(db.insertBatch).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionId: undefined }),
    )
  })

  it('passes all artist fields to upsertArtist', async () => {
    const artist: ScoredArtist = {
      mbid: 'mbid-full',
      name: 'Full Artist',
      disambiguation: 'the band',
      tags: ['electronic', 'ambient'],
      genres: ['electronic'],
      imageUrl: 'https://example.com/img.jpg',
      streamingUrls: { spotify: 'https://spotify.com/foo' },
      discoveries: [],
      score: 0.9,
      sourceScores: {
        consensus: 1,
        similarity: 1,
        genreOverlap: 1,
        aiConfidence: 1,
        feedbackBoost: 1,
      },
    }
    const db = makeDb()

    await store([artist], db)

    expect(db.upsertArtist).toHaveBeenCalledWith({
      mbid: 'mbid-full',
      name: 'Full Artist',
      disambiguation: 'the band',
      tags: ['electronic', 'ambient'],
      genres: ['electronic'],
      imageUrl: 'https://example.com/img.jpg',
      streamingUrls: { spotify: 'https://spotify.com/foo' },
    })
  })
})
