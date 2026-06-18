import type { ScoredArtist } from '@/core/types'

// Minimal database interface - only what store() needs
export interface StoreDb {
  getExistingRecommendationMbids: (userId?: number) => Promise<Set<string>>

  insertBatch: (data: {
    status: string
    stats: Record<string, unknown>
    subscriptionId?: number
  }) => Promise<{ id: number }>

  completeBatch: (
    id: number,
    stats: { discovered: number; added: number; failed: number },
  ) => Promise<void>

  upsertArtist: (data: {
    mbid: string
    name: string
    disambiguation?: string
    tags: string[]
    genres: string[]
    imageUrl?: string
    logoUrl?: string
    imageFailed?: boolean
    streamingUrls: Record<string, string>
    beginYear?: number
    endYear?: number
  }) => Promise<{ id: number }>

  insertRecommendation: (data: {
    artistId: number
    batchId: number
    score: number
    sources: Record<string, number>
    aiReasoning?: string
    status: string
    userId?: number
    recommendedReleaseGroupId?: string
    recommendedReleaseGroupTitle?: string
  }) => Promise<void>

  getRejectedMbids: (cooldownDays: number) => Promise<Set<string>>

  getBlockedMbids: (userId: number) => Promise<Set<string>>

  getFeedbackHistory: (userId?: number) => Promise<Map<string, { approved: number; total: number }>>

  lookupArtistMetadata?: (name: string) => Promise<{
    spotifyGenres: string[] | null
    spotifyPopularity: number | null
  } | null>

  getPopularityMap?: () => Promise<Map<string, number>>

  getLibraryArtistsForUser?: (
    userId: number,
    options?: { onlyReconciled?: boolean; source?: string },
  ) => Promise<
    Array<{
      mbid: string | null
      name: string
      source: string
      sourceArtistId: string
      genres: string[] | null
      matchMethod: string | null
      matchConfidence: number | null
    }>
  >

  userHasAnySyncState?: (userId: number) => Promise<boolean>

  // Optional atomic variant: wraps upsertArtist + insertRecommendation in a
  // single DB transaction so a crash between the two cannot leave an artist
  // row without a matching recommendation. Prod wiring provides this; test
  // mocks keep the two separate methods.
  upsertArtistAndRecommendation?: (
    artist: Parameters<StoreDb['upsertArtist']>[0],
    rec: Omit<Parameters<StoreDb['insertRecommendation']>[0], 'artistId'>,
  ) => Promise<void>

  tryConsumeRateLimit?: (
    key: string,
    config: { capacity: number; refillPerMs: number },
  ) => Promise<boolean>
}

export type StoreOptions = {
  userId?: number
  subscriptionId?: number
}

export async function store(
  artists: ScoredArtist[],
  db: StoreDb,
  options: StoreOptions = {},
): Promise<number> {
  const batch = await db.insertBatch({
    status: 'running',
    stats: {
      total: artists.length,
      createdAt: new Date().toISOString(),
    },
    subscriptionId: options.subscriptionId,
  })

  let added = 0
  let failed = 0

  for (const artist of artists) {
    const artistData = {
      mbid: artist.mbid,
      name: artist.name,
      disambiguation: artist.disambiguation,
      tags: artist.tags,
      genres: artist.genres,
      imageUrl: artist.imageUrl,
      logoUrl: artist.logoUrl,
      imageFailed: artist.imageFailed,
      streamingUrls: artist.streamingUrls,
      beginYear: artist.beginYear,
      endYear: artist.endYear,
    }
    const recData = {
      batchId: batch.id,
      score: artist.score,
      sources: artist.sourceScores,
      aiReasoning: artist.aiReasoning,
      status: 'pending',
      userId: options.userId,
      recommendedReleaseGroupId: artist.suggestedAlbum?.releaseGroupId,
      recommendedReleaseGroupTitle: artist.suggestedAlbum?.title,
    }

    try {
      if (db.upsertArtistAndRecommendation) {
        await db.upsertArtistAndRecommendation(artistData, recData)
      } else {
        const upserted = await db.upsertArtist(artistData)
        await db.insertRecommendation({ ...recData, artistId: upserted.id })
      }
      added++
    } catch (err: unknown) {
      failed++
      console.error(`Failed to store artist ${artist.mbid}:`, err)
    }
  }

  await db.completeBatch(batch.id, {
    discovered: artists.length,
    added,
    failed,
  })

  return batch.id
}
