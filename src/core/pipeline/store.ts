import type { ScoredArtist } from '@/core/types'

// Minimal database interface -- only what store() needs
export interface StoreDb {
  getExistingRecommendationMbids: () => Promise<Set<string>>

  insertBatch: (data: { status: string; stats: Record<string, unknown> }) => Promise<{ id: number }>

  completeBatch: (id: number) => Promise<void>

  upsertArtist: (data: {
    mbid: string
    name: string
    disambiguation?: string
    tags: string[]
    genres: string[]
    imageUrl?: string
    streamingUrls: Record<string, string>
  }) => Promise<{ id: number }>

  insertRecommendation: (data: {
    artistId: number
    batchId: number
    score: number
    sources: Record<string, number>
    aiReasoning?: string
    status: string
  }) => Promise<void>

  getRejectedMbids: (cooldownDays: number) => Promise<Set<string>>

  getFeedbackHistory: () => Promise<Map<string, { approved: number; total: number }>>
}

export async function store(artists: ScoredArtist[], db: StoreDb): Promise<number> {
  // Create the batch row in running state
  const batch = await db.insertBatch({
    status: 'running',
    stats: {
      total: artists.length,
      createdAt: new Date().toISOString(),
    },
  })

  const batchId = batch.id

  // Upsert each artist and create a recommendation row
  for (const artist of artists) {
    const upserted = await db.upsertArtist({
      mbid: artist.mbid,
      name: artist.name,
      disambiguation: artist.disambiguation,
      tags: artist.tags,
      genres: artist.genres,
      imageUrl: artist.imageUrl,
      streamingUrls: artist.streamingUrls,
    })

    await db.insertRecommendation({
      artistId: upserted.id,
      batchId,
      score: artist.score,
      sources: artist.sourceScores,
      aiReasoning: artist.aiReasoning,
      status: 'pending',
    })
  }

  // Mark batch as completed after all inserts succeed
  await db.completeBatch(batchId)

  return batchId
}
