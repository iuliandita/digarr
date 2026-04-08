import { and, eq, getTableColumns, isNotNull, isNull, or } from 'drizzle-orm'
import {
  type LibrarySyncCounts,
  libraryAlbumMatchOverrides,
  libraryAlbums,
  libraryArtists,
  libraryMatchOverrides,
  librarySyncState,
} from '@/db/schema'
import type { ReconciledAlbum } from './album-reconciler'
import type { ReconciledArtist, ReconcilerOverride } from './reconciler'

type Db = import('@/db').Database

export type LibrarySyncStateRow = {
  userId: number | null
  source: string
  lastSyncStartedAt: Date | null
  lastSyncCompletedAt: Date | null
  lastSyncStatus: string | null
  lastSyncError: string | null
  lastSyncCounts: LibrarySyncCounts | null
}

export type LibrarySyncStorePatch = Partial<{
  lastSyncStartedAt: Date | null
  lastSyncCompletedAt: Date | null
  lastSyncStatus: string | null
  lastSyncError: string | null
  lastSyncCounts: LibrarySyncCounts | null
}>

export interface LibrarySyncStore {
  replaceLibrarySnapshot(
    userId: number | null,
    source: string,
    artists: ReconciledArtist[],
    albums: ReconciledAlbum[],
  ): Promise<LibrarySyncCounts>

  replaceLibraryArtists(
    userId: number | null,
    source: string,
    artists: ReconciledArtist[],
  ): Promise<LibrarySyncCounts>

  replaceLibraryAlbums(
    userId: number | null,
    source: string,
    albums: ReconciledAlbum[],
  ): Promise<{ total: number }>

  findReconciledByNormalizedName(
    userId: number,
    nameNormalized: string,
  ): Promise<Array<{ mbid: string; name: string; source: string }>>

  getLibrarySyncState(userId: number | null, source: string): Promise<LibrarySyncStateRow | null>

  upsertLibrarySyncState(
    userId: number | null,
    source: string,
    patch: LibrarySyncStorePatch,
  ): Promise<void>

  getOverride(
    userId: number,
    source: string,
    sourceArtistId: string,
  ): Promise<ReconcilerOverride | null>

  getAllOverrides(userId: number): Promise<Map<string, ReconcilerOverride>>

  upsertOverride(
    userId: number,
    source: string,
    sourceArtistId: string,
    correctMbid: string | null,
    note?: string,
  ): Promise<void>

  deleteOverride(userId: number, source: string, sourceArtistId: string): Promise<void>

  upsertAlbumOverride(
    userId: number,
    source: string,
    sourceAlbumId: string,
    correctAlbumMbid: string | null,
    note?: string,
  ): Promise<void>

  deleteAlbumOverride(userId: number, source: string, sourceAlbumId: string): Promise<void>

  listAlbumOverrides(
    userId: number,
  ): Promise<Array<{ source: string; sourceAlbumId: string; correctAlbumMbid: string | null }>>

  getKnownMbidsForUser(userId: number): Promise<Set<string>>

  userHasAnySyncState(userId: number): Promise<boolean>

  listSyncStateForUser(userId: number): Promise<LibrarySyncStateRow[]>

  listUnreconciledForUser(userId: number): Promise<LibraryArtistRow[]>

  listUnreconciledAlbumsForUser(userId: number): Promise<LibraryAlbumRow[]>

  listOwnedAlbumsForArtist(
    userId: number,
    artistMbid: string,
  ): Promise<
    Array<{
      source: string
      sourceAlbumId: string
      albumMbid: string
      title: string
      releaseYear: number | null
      primaryType: string | null
    }>
  >
}

export type LibraryArtistRow = typeof libraryArtists.$inferSelect
export type LibraryAlbumRow = typeof libraryAlbums.$inferSelect
export type LibraryAlbumOverrideRow = typeof libraryAlbumMatchOverrides.$inferSelect

export function emptyLibrarySyncCounts(): LibrarySyncCounts {
  return {
    total: 0,
    matchedMbid: 0,
    matchedNameExact: 0,
    matchedNameAnchored: 0,
    matchedDisambiguated: 0,
    unreconciledAmbiguous: 0,
    unreconciledNoCandidate: 0,
    cacheHits: 0,
    mbApiCalls: 0,
  }
}

export function createLibrarySyncStore(database: Db): LibrarySyncStore {
  function makeUserClause(userId: number | null) {
    return userId === null ? isNull(libraryArtists.userId) : eq(libraryArtists.userId, userId)
  }

  function countArtists(artists: ReconciledArtist[]): LibrarySyncCounts {
    const counts = emptyLibrarySyncCounts()
    for (const a of artists) {
      counts.total += 1
      switch (a.matchMethod) {
        case 'mbid':
          counts.matchedMbid += 1
          break
        case 'name_exact':
          counts.matchedNameExact += 1
          break
        case 'name_anchored':
          counts.matchedNameAnchored += 1
          break
        case 'name_disambiguated':
          counts.matchedDisambiguated += 1
          break
        case null:
          if (a.unreconciledReason === 'ambiguous') counts.unreconciledAmbiguous += 1
          else if (a.unreconciledReason === 'no_candidate') counts.unreconciledNoCandidate += 1
          break
      }
    }
    return counts
  }

  async function getLibrarySyncState(
    userId: number | null,
    source: string,
  ): Promise<LibrarySyncStateRow | null> {
    const userClause =
      userId === null ? isNull(librarySyncState.userId) : eq(librarySyncState.userId, userId)
    const rows = await database
      .select()
      .from(librarySyncState)
      .where(and(userClause, eq(librarySyncState.source, source)))
      .limit(1)
    const row = rows[0]
    if (!row) return null
    return row as LibrarySyncStateRow
  }

  async function getOverride(
    userId: number,
    source: string,
    sourceArtistId: string,
  ): Promise<ReconcilerOverride | null> {
    const rows = await database
      .select()
      .from(libraryMatchOverrides)
      .where(
        and(
          eq(libraryMatchOverrides.userId, userId),
          eq(libraryMatchOverrides.source, source),
          eq(libraryMatchOverrides.sourceArtistId, sourceArtistId),
        ),
      )
      .limit(1)
    const row = rows[0]
    return row ? { correctMbid: row.correctMbid } : null
  }

  return {
    async replaceLibrarySnapshot(userId, source, artists, albums) {
      const counts = countArtists(artists)
      counts.albumsSynced = albums.length

      await database.transaction(async (tx) => {
        const artistUserClause =
          userId === null ? isNull(libraryArtists.userId) : eq(libraryArtists.userId, userId)
        const albumUserClause =
          userId === null ? isNull(libraryAlbums.userId) : eq(libraryAlbums.userId, userId)
        await tx
          .delete(libraryArtists)
          .where(and(artistUserClause, eq(libraryArtists.source, source)))
        await tx.delete(libraryAlbums).where(and(albumUserClause, eq(libraryAlbums.source, source)))

        if (artists.length > 0) {
          await tx.insert(libraryArtists).values(
            artists.map((a) => ({
              userId,
              source,
              sourceArtistId: a.sourceArtistId,
              name: a.name,
              nameNormalized: a.nameNormalized,
              mbid: a.mbid,
              matchMethod: a.matchMethod,
              matchConfidence: a.matchConfidence,
              genres: a.genres,
            })),
          )
        }

        if (albums.length > 0) {
          await tx.insert(libraryAlbums).values(
            albums.map((album) => ({
              userId,
              source,
              sourceAlbumId: album.sourceAlbumId,
              sourceArtistId: album.sourceArtistId,
              title: album.title,
              titleNormalized: album.titleNormalized,
              albumMbid: album.albumMbid,
              artistMbid: album.artistMbid,
              releaseYear: album.releaseYear,
              primaryType: album.primaryType,
              matchMethod: album.matchMethod,
              matchConfidence: album.matchConfidence,
            })),
          )
        }
      })

      return counts
    },

    async replaceLibraryArtists(userId, source, artists) {
      const counts = countArtists(artists)

      await database.transaction(async (tx) => {
        // Truncate per (userId, source)
        const userClause = makeUserClause(userId)
        await tx.delete(libraryArtists).where(and(userClause, eq(libraryArtists.source, source)))

        if (artists.length === 0) return
        await tx.insert(libraryArtists).values(
          artists.map((a) => ({
            userId,
            source,
            sourceArtistId: a.sourceArtistId,
            name: a.name,
            nameNormalized: a.nameNormalized,
            mbid: a.mbid,
            matchMethod: a.matchMethod,
            matchConfidence: a.matchConfidence,
            genres: a.genres,
          })),
        )
      })

      return counts
    },

    async replaceLibraryAlbums(userId, source, albums) {
      await database.transaction(async (tx) => {
        const userClause =
          userId === null ? isNull(libraryAlbums.userId) : eq(libraryAlbums.userId, userId)
        await tx.delete(libraryAlbums).where(and(userClause, eq(libraryAlbums.source, source)))

        if (albums.length === 0) return

        await tx.insert(libraryAlbums).values(
          albums.map((album) => ({
            userId,
            source,
            sourceAlbumId: album.sourceAlbumId,
            sourceArtistId: album.sourceArtistId,
            title: album.title,
            titleNormalized: album.titleNormalized,
            albumMbid: album.albumMbid,
            artistMbid: album.artistMbid,
            releaseYear: album.releaseYear,
            primaryType: album.primaryType,
            matchMethod: album.matchMethod,
            matchConfidence: album.matchConfidence,
          })),
        )
      })

      return { total: albums.length }
    },

    async findReconciledByNormalizedName(userId, nameNormalized) {
      const rows = await database
        .select({
          mbid: libraryArtists.mbid,
          name: libraryArtists.name,
          source: libraryArtists.source,
        })
        .from(libraryArtists)
        .where(
          and(
            eq(libraryArtists.nameNormalized, nameNormalized),
            isNotNull(libraryArtists.mbid),
            or(eq(libraryArtists.userId, userId), isNull(libraryArtists.userId)),
          ),
        )
      return rows.filter(
        (r): r is { mbid: string; name: string; source: string } => r.mbid !== null,
      )
    },

    getLibrarySyncState,

    async upsertLibrarySyncState(userId, source, patch) {
      const existing = await getLibrarySyncState(userId, source)
      if (existing) {
        const userClause =
          userId === null ? isNull(librarySyncState.userId) : eq(librarySyncState.userId, userId)
        await database
          .update(librarySyncState)
          .set(patch)
          .where(and(userClause, eq(librarySyncState.source, source)))
      } else {
        await database.insert(librarySyncState).values({
          userId,
          source,
          lastSyncStartedAt: patch.lastSyncStartedAt ?? null,
          lastSyncCompletedAt: patch.lastSyncCompletedAt ?? null,
          lastSyncStatus: patch.lastSyncStatus ?? null,
          lastSyncError: patch.lastSyncError ?? null,
          lastSyncCounts: patch.lastSyncCounts ?? null,
        })
      }
    },

    getOverride,

    async getAllOverrides(userId) {
      const rows = await database
        .select()
        .from(libraryMatchOverrides)
        .where(eq(libraryMatchOverrides.userId, userId))
      const map = new Map<string, ReconcilerOverride>()
      for (const r of rows) {
        map.set(`${r.source}:${r.sourceArtistId}`, { correctMbid: r.correctMbid })
      }
      return map
    },

    async upsertOverride(userId, source, sourceArtistId, correctMbid, note) {
      const existing = await getOverride(userId, source, sourceArtistId)
      if (existing) {
        await database
          .update(libraryMatchOverrides)
          .set({ correctMbid, note: note ?? null, updatedAt: new Date() })
          .where(
            and(
              eq(libraryMatchOverrides.userId, userId),
              eq(libraryMatchOverrides.source, source),
              eq(libraryMatchOverrides.sourceArtistId, sourceArtistId),
            ),
          )
      } else {
        await database.insert(libraryMatchOverrides).values({
          userId,
          source,
          sourceArtistId,
          correctMbid,
          note: note ?? null,
        })
      }
    },

    async deleteOverride(userId, source, sourceArtistId) {
      await database
        .delete(libraryMatchOverrides)
        .where(
          and(
            eq(libraryMatchOverrides.userId, userId),
            eq(libraryMatchOverrides.source, source),
            eq(libraryMatchOverrides.sourceArtistId, sourceArtistId),
          ),
        )
    },

    async upsertAlbumOverride(userId, source, sourceAlbumId, correctAlbumMbid, note) {
      const existing = await database
        .select({ id: libraryAlbumMatchOverrides.id })
        .from(libraryAlbumMatchOverrides)
        .where(
          and(
            eq(libraryAlbumMatchOverrides.userId, userId),
            eq(libraryAlbumMatchOverrides.source, source),
            eq(libraryAlbumMatchOverrides.sourceAlbumId, sourceAlbumId),
          ),
        )
        .limit(1)

      if (existing[0]) {
        await database
          .update(libraryAlbumMatchOverrides)
          .set({ correctAlbumMbid, note: note ?? null, updatedAt: new Date() })
          .where(
            and(
              eq(libraryAlbumMatchOverrides.userId, userId),
              eq(libraryAlbumMatchOverrides.source, source),
              eq(libraryAlbumMatchOverrides.sourceAlbumId, sourceAlbumId),
            ),
          )
      } else {
        await database.insert(libraryAlbumMatchOverrides).values({
          userId,
          source,
          sourceAlbumId,
          correctAlbumMbid,
          note: note ?? null,
        })
      }
    },

    async deleteAlbumOverride(userId, source, sourceAlbumId) {
      await database
        .delete(libraryAlbumMatchOverrides)
        .where(
          and(
            eq(libraryAlbumMatchOverrides.userId, userId),
            eq(libraryAlbumMatchOverrides.source, source),
            eq(libraryAlbumMatchOverrides.sourceAlbumId, sourceAlbumId),
          ),
        )
    },

    async listAlbumOverrides(userId) {
      return database
        .select({
          source: libraryAlbumMatchOverrides.source,
          sourceAlbumId: libraryAlbumMatchOverrides.sourceAlbumId,
          correctAlbumMbid: libraryAlbumMatchOverrides.correctAlbumMbid,
        })
        .from(libraryAlbumMatchOverrides)
        .where(eq(libraryAlbumMatchOverrides.userId, userId))
    },

    async getKnownMbidsForUser(userId) {
      const rows = await database
        .select({ mbid: libraryArtists.mbid })
        .from(libraryArtists)
        .where(
          and(
            isNotNull(libraryArtists.mbid),
            or(eq(libraryArtists.userId, userId), isNull(libraryArtists.userId)),
          ),
        )
      const set = new Set<string>()
      for (const r of rows) {
        if (r.mbid) set.add(r.mbid)
      }
      return set
    },

    async userHasAnySyncState(userId) {
      const rows = await database
        .select({ id: librarySyncState.id })
        .from(librarySyncState)
        .where(or(eq(librarySyncState.userId, userId), isNull(librarySyncState.userId)))
        .limit(1)
      return rows.length > 0
    },

    async listSyncStateForUser(userId) {
      const rows = await database
        .select()
        .from(librarySyncState)
        .where(or(eq(librarySyncState.userId, userId), isNull(librarySyncState.userId)))
      return rows as LibrarySyncStateRow[]
    },

    async listUnreconciledForUser(userId) {
      return database
        .select({ ...getTableColumns(libraryArtists) })
        .from(libraryArtists)
        .leftJoin(
          libraryMatchOverrides,
          and(
            eq(libraryMatchOverrides.userId, userId),
            eq(libraryMatchOverrides.source, libraryArtists.source),
            eq(libraryMatchOverrides.sourceArtistId, libraryArtists.sourceArtistId),
          ),
        )
        .where(
          and(
            isNull(libraryArtists.mbid),
            or(eq(libraryArtists.userId, userId), isNull(libraryArtists.userId)),
            isNull(libraryMatchOverrides.id),
          ),
        )
    },

    async listUnreconciledAlbumsForUser(userId) {
      return database
        .select({ ...getTableColumns(libraryAlbums) })
        .from(libraryAlbums)
        .leftJoin(
          libraryAlbumMatchOverrides,
          and(
            eq(libraryAlbumMatchOverrides.userId, userId),
            eq(libraryAlbumMatchOverrides.source, libraryAlbums.source),
            eq(libraryAlbumMatchOverrides.sourceAlbumId, libraryAlbums.sourceAlbumId),
          ),
        )
        .where(
          and(
            isNull(libraryAlbums.albumMbid),
            or(eq(libraryAlbums.userId, userId), isNull(libraryAlbums.userId)),
            isNull(libraryAlbumMatchOverrides.id),
          ),
        )
    },

    async listOwnedAlbumsForArtist(userId, artistMbid) {
      const rows = await database
        .select({
          source: libraryAlbums.source,
          sourceAlbumId: libraryAlbums.sourceAlbumId,
          albumMbid: libraryAlbums.albumMbid,
          title: libraryAlbums.title,
          releaseYear: libraryAlbums.releaseYear,
          primaryType: libraryAlbums.primaryType,
        })
        .from(libraryAlbums)
        .where(
          and(
            eq(libraryAlbums.artistMbid, artistMbid),
            eq(libraryAlbums.primaryType, 'Album'),
            isNotNull(libraryAlbums.albumMbid),
            or(eq(libraryAlbums.userId, userId), isNull(libraryAlbums.userId)),
          ),
        )

      return rows.filter(
        (
          row,
        ): row is {
          source: string
          sourceAlbumId: string
          albumMbid: string
          title: string
          releaseYear: number | null
          primaryType: string | null
        } => row.albumMbid !== null,
      )
    },
  }
}
