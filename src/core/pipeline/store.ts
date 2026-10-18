import { sql } from 'drizzle-orm'
import type { ScoredArtist } from '@/core/types'
import type { Database } from '@/db'
import { artists as artistTable, recommendations } from '@/db/schema'
import { checkPipelineCancelled, PipelineCancelledError } from './cancel'
import type { GenreFeedback } from './score'

// Minimal database interface - only what store() needs
export interface StoreDb {
  // With rejectionCooldownDays, rejections older than the cooldown are excluded.
  getExistingRecommendationMbids: (
    userId?: number,
    options?: { rejectionCooldownDays?: number },
  ) => Promise<Set<string>>
  getExistingAlbumReleaseGroupMbids?: (
    userId?: number,
    options?: { rejectionCooldownDays?: number },
  ) => Promise<Set<string>>
  getBlockedAlbumKeys?: (userId: number) => Promise<Set<string>>
  getOwnedAlbumKeys?: (
    userId: number,
  ) => Promise<import('@/db/queries/library-albums').OwnedAlbumKeys>
  getArtistGenreCacheByMbids?: import('./genre-backfill').GenreBackfillDb['getArtistGenreCacheByMbids']
  getArtistGenreCacheByAliases?: import('./genre-backfill').GenreBackfillDb['getArtistGenreCacheByAliases']
  upsertArtistGenres?: import('./genre-backfill').GenreBackfillDb['upsertArtistGenres']
  upsertArtistGenreAlias?: import('./genre-backfill').GenreBackfillDb['upsertArtistGenreAlias']

  insertBatch: (data: {
    status: string
    stats: Record<string, unknown>
    subscriptionId?: number
  }) => Promise<{ id: number }>

  completeBatch: (
    id: number,
    stats: { discovered: number; added: number; failed: number },
  ) => Promise<void>

  failBatch: (id: number) => Promise<void>

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
    kind?: 'artist' | 'album'
  }) => Promise<void>

  getRejectedMbids: (cooldownDays: number, userId: number | null) => Promise<Set<string>>

  getBlockedMbids: (userId: number) => Promise<Set<string>>
  getBlockedArtistNames?: (userId: number) => Promise<string[]>

  getFeedbackHistory: (userId?: number) => Promise<Map<string, GenreFeedback>>

  lookupArtistMetadata?: (name: string) => Promise<{
    spotifyGenres: string[] | null
    spotifyPopularity: number | null
  } | null>

  getPopularityMap?: (names: string[]) => Promise<Map<string, number>>

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

  userHasOwnSyncState?: (userId: number) => Promise<boolean>

  // Optional atomic variant: wraps upsertArtist + insertRecommendation in a
  // single DB transaction so a crash between the two cannot leave an artist
  // row without a matching recommendation. Prod wiring provides this; test
  // mocks keep the two separate methods.
  upsertArtistAndRecommendation?: (
    artist: Parameters<StoreDb['upsertArtist']>[0],
    rec: Omit<Parameters<StoreDb['insertRecommendation']>[0], 'artistId'>,
  ) => Promise<void>

  saveRecommendationChunk?: (entries: RecommendationEntry[]) => Promise<void>

  tryConsumeRateLimit?: (
    key: string,
    config: { capacity: number; refillPerMs: number },
  ) => Promise<boolean>
}

export type RecommendationEntry = {
  artist: Parameters<StoreDb['upsertArtist']>[0]
  recommendation: Omit<Parameters<StoreDb['insertRecommendation']>[0], 'artistId'>
}

export async function saveRecommendationChunk(
  db: Database,
  entries: RecommendationEntry[],
): Promise<void> {
  if (entries.length === 0) return
  const unique = new Map<string, typeof artistTable.$inferInsert>()
  for (const { artist } of entries) {
    const previous = unique.get(artist.mbid)
    const { imageFailed, ...data } = artist
    unique.set(artist.mbid, {
      ...previous,
      ...Object.fromEntries(Object.entries(data).filter(([, value]) => value != null)),
      mbid: artist.mbid,
      name: artist.name,
      cachedAt: new Date(),
      genresCachedAt: new Date(),
      imageFailedAt: artist.imageUrl ? null : imageFailed ? new Date() : previous?.imageFailedAt,
    })
  }
  await db.transaction(async (tx) => {
    const rows = await tx
      .insert(artistTable)
      .values([...unique.values()])
      .onConflictDoUpdate({
        target: artistTable.mbid,
        set: {
          name: sql`excluded.name`,
          disambiguation: sql`COALESCE(excluded.disambiguation, ${artistTable.disambiguation})`,
          tags: sql`COALESCE(excluded.tags, ${artistTable.tags})`,
          genres: sql`COALESCE(excluded.genres, ${artistTable.genres})`,
          imageUrl: sql`COALESCE(excluded.image_url, ${artistTable.imageUrl})`,
          logoUrl: sql`COALESCE(excluded.logo_url, ${artistTable.logoUrl})`,
          streamingUrls: sql`COALESCE(excluded.streaming_urls, ${artistTable.streamingUrls})`,
          beginYear: sql`COALESCE(excluded.begin_year, ${artistTable.beginYear})`,
          endYear: sql`COALESCE(excluded.end_year, ${artistTable.endYear})`,
          imageFailedAt: sql`CASE WHEN excluded.image_failed_at IS NOT NULL THEN NOW() WHEN excluded.image_url IS NOT NULL THEN NULL ELSE ${artistTable.imageFailedAt} END`,
          cachedAt: sql`excluded.cached_at`,
          genresCachedAt: sql`excluded.genres_cached_at`,
        },
      })
      .returning({ id: artistTable.id, mbid: artistTable.mbid })
    const ids = new Map(rows.map((row) => [row.mbid, row.id]))
    await tx.insert(recommendations).values(
      entries.map(({ artist, recommendation }) => {
        const artistId = ids.get(artist.mbid)
        if (artistId === undefined) throw new Error(`Missing stored artist ${artist.mbid}`)
        return { ...recommendation, artistId }
      }),
    )
  })
}

export type StoreOptions = {
  signal?: AbortSignal
  userId?: number
  subscriptionId?: number
}

export async function store(
  artists: ScoredArtist[],
  db: StoreDb,
  options: StoreOptions = {},
): Promise<number> {
  checkPipelineCancelled(options.signal)
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

  try {
    const entries = artists.map((artist): RecommendationEntry => {
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
        kind: artist.kind ?? 'artist',
      }

      return { artist: artistData, recommendation: recData }
    })
    async function saveOne(entry: RecommendationEntry) {
      checkPipelineCancelled(options.signal)
      try {
        if (db.upsertArtistAndRecommendation) {
          await db.upsertArtistAndRecommendation(entry.artist, entry.recommendation)
        } else {
          const upserted = await db.upsertArtist(entry.artist)
          await db.insertRecommendation({ ...entry.recommendation, artistId: upserted.id })
        }
        added++
      } catch (err: unknown) {
        if (err instanceof PipelineCancelledError || options.signal?.aborted) throw err
        failed++
        console.error(`Failed to store artist ${entry.artist.mbid}:`, err)
      }
    }
    for (let offset = 0; offset < entries.length; offset += 200) {
      checkPipelineCancelled(options.signal)
      const chunk = entries.slice(offset, offset + 200)
      if (db.saveRecommendationChunk) {
        try {
          await db.saveRecommendationChunk(chunk)
          added += chunk.length
          continue
        } catch (err) {
          if (err instanceof PipelineCancelledError || options.signal?.aborted) throw err
          // The failed transaction rolled back; isolate bad rows without losing the rest.
        }
      }
      for (const entry of chunk) await saveOne(entry)
    }

    checkPipelineCancelled(options.signal)
    await db.completeBatch(batch.id, {
      discovered: artists.length,
      added,
      failed,
    })

    return batch.id
  } catch (err) {
    // A throw here (e.g. completeBatch hitting a DB error) would otherwise
    // strand the batch in 'running' forever. Transition it to 'failed' before
    // re-raising so the admin jobs view and stuck-detector see the truth.
    try {
      await db.failBatch(batch.id)
    } catch (cleanupError) {
      if (err instanceof PipelineCancelledError) {
        throw new AggregateError([err, cleanupError], 'Failed to cancel pipeline batch')
      }
      console.error('Failed to mark pipeline batch failed:', cleanupError)
    }
    throw err
  }
}
