import { and, asc, desc, eq, isNotNull, lt, ne, notExists, or, sql } from 'drizzle-orm'
import type { Database } from '@/db'
import { playlistResolution } from '@/db/queries/jobs'
import type { PlaylistConfig, PlaylistStrategy } from '@/db/schema'
import { artists, jobRuns, playlists, playlistTracks, recommendations } from '@/db/schema'
import type { Cursor } from '@/server/helpers/pagination-cursor'

export type PlaylistInsert = {
  userId?: number | null
  name: string
  strategy: PlaylistStrategy
  targetIds?: number[]
  schedule?: string | null
  config?: PlaylistConfig | null
  enabled?: boolean
}

export type PlaylistUpdate = Partial<
  Pick<PlaylistInsert, 'name' | 'strategy' | 'targetIds' | 'schedule' | 'config' | 'enabled'> & {
    lastGeneratedAt: Date | null
    trackCount: number
  }
>

export type PlaylistRow = typeof playlists.$inferSelect

export type PlaylistTrackInsert = {
  playlistId: number
  artistName: string
  trackName?: string | null
  mbid?: string | null
  spotifyUri?: string | null
  deezerId?: string | null
  localPath?: string | null
  position: number
}

export type PlaylistTrackRow = typeof playlistTracks.$inferSelect

export async function getOwnedAuditionTrack(
  db: Database,
  userId: number,
  trackId: number,
  artistMbid: string,
) {
  const [track] = await db
    .select({
      artistName: playlistTracks.artistName,
      trackName: playlistTracks.trackName,
      recordingMbid: playlistTracks.mbid,
    })
    .from(playlistTracks)
    .innerJoin(playlists, eq(playlists.id, playlistTracks.playlistId))
    .where(
      and(
        eq(playlistTracks.id, trackId),
        eq(playlists.userId, userId),
        eq(playlists.strategy, 'audition'),
        notExists(
          db
            .select({ id: artists.id })
            .from(artists)
            .where(
              and(
                sql`lower(trim(${artists.name})) = lower(trim(${playlistTracks.artistName}))`,
                ne(artists.mbid, artistMbid),
              ),
            ),
        ),
      ),
    )
    .limit(1)
  return track ?? null
}

export type PendingPlayability = {
  pendingArtists: number
  withTrack: number
  withoutTrack: number
  reasons: { missingSource: number; noMatch: number; upstreamFailure: number }
  unknown: number
  checkedAt: string | null
}

const PLAYABILITY_RUN_LIMIT = 20

/**
 * Classifies pending artists from outcomes already persisted by Audition playlist
 * runs; artists no run has resolved yet are counted as unknown, never as missing.
 */
export async function getPendingPlayability(
  db: Database,
  userId: number,
): Promise<PendingPlayability> {
  const [pending, runs] = await Promise.all([
    db
      .selectDistinct({ mbid: artists.mbid })
      .from(recommendations)
      .innerJoin(artists, eq(artists.id, recommendations.artistId))
      .where(and(eq(recommendations.status, 'pending'), eq(recommendations.userId, userId))),
    db
      .select({
        startedAt: jobRuns.startedAt,
        resolution: sql<unknown>`${jobRuns.metadata}->'playlistResolution'`,
      })
      .from(jobRuns)
      .innerJoin(playlists, sql`${jobRuns.metadata}->>'playlistId' = ${playlists.id}::text`)
      .where(
        and(
          eq(jobRuns.type, 'playlist'),
          eq(jobRuns.userId, userId),
          eq(playlists.userId, userId),
          eq(playlists.strategy, 'audition'),
        ),
      )
      .orderBy(desc(jobRuns.startedAt), desc(jobRuns.id))
      .limit(PLAYABILITY_RUN_LIMIT),
  ])

  const latest = new Map<string, { status: string; startedAt: Date }>()
  for (const run of runs) {
    for (const outcome of playlistResolution(run.resolution)?.outcomes ?? []) {
      if (outcome.artistMbid && !latest.has(outcome.artistMbid)) {
        latest.set(outcome.artistMbid, { status: outcome.status, startedAt: run.startedAt })
      }
    }
  }

  const summary: PendingPlayability = {
    pendingArtists: pending.length,
    withTrack: 0,
    withoutTrack: 0,
    reasons: { missingSource: 0, noMatch: 0, upstreamFailure: 0 },
    unknown: 0,
    checkedAt: null,
  }
  let checkedAt: Date | null = null
  for (const { mbid } of pending) {
    const outcome = latest.get(mbid)
    if (!outcome) {
      summary.unknown++
      continue
    }
    if (!checkedAt || outcome.startedAt > checkedAt) checkedAt = outcome.startedAt
    if (outcome.status === 'resolved' || outcome.status === 'limited') summary.withTrack++
    else {
      summary.withoutTrack++
      if (outcome.status === 'unavailable') summary.reasons.missingSource++
      else if (outcome.status === 'unmatched') summary.reasons.noMatch++
      else summary.reasons.upstreamFailure++
    }
  }
  summary.checkedAt = checkedAt?.toISOString() ?? null
  return summary
}

export async function createPlaylist(db: Database, data: PlaylistInsert): Promise<{ id: number }> {
  const [row] = await db
    .insert(playlists)
    .values({
      userId: data.userId ?? null,
      name: data.name,
      strategy: data.strategy,
      targetIds: data.targetIds ?? [],
      schedule: data.schedule ?? null,
      config: data.config ?? null,
      enabled: data.enabled ?? true,
    })
    .returning({ id: playlists.id })
  if (!row) throw new Error('createPlaylist: no row returned')
  return { id: row.id }
}

export async function getPlaylistsByUser(
  db: Database,
  userId: number,
  opts: { limit?: number; cursor?: Cursor | null } = {},
): Promise<PlaylistRow[]> {
  const conditions = [eq(playlists.userId, userId)]
  if (opts.cursor) {
    conditions.push(
      or(
        lt(playlists.createdAt, new Date(opts.cursor.ts)),
        and(eq(playlists.createdAt, new Date(opts.cursor.ts)), lt(playlists.id, opts.cursor.id)),
      ) as NonNullable<ReturnType<typeof or>>,
    )
  }
  const base = db
    .select()
    .from(playlists)
    .where(and(...conditions))
    .orderBy(desc(playlists.createdAt), desc(playlists.id))
  return opts.limit ? base.limit(opts.limit) : base
}

export async function getScheduledPlaylists(db: Database): Promise<PlaylistRow[]> {
  return db.select().from(playlists).where(isNotNull(playlists.schedule))
}

export async function getPlaylistWithTracks(
  db: Database,
  playlistId: number,
): Promise<{ playlist: PlaylistRow; tracks: PlaylistTrackRow[] } | null> {
  const [playlist] = await db.select().from(playlists).where(eq(playlists.id, playlistId))
  if (!playlist) return null

  const tracks = await db
    .select()
    .from(playlistTracks)
    .where(eq(playlistTracks.playlistId, playlistId))
    .orderBy(asc(playlistTracks.position))

  return {
    playlist,
    tracks,
  }
}

export async function updatePlaylist(
  db: Database,
  id: number,
  data: PlaylistUpdate,
): Promise<void> {
  await db.update(playlists).set(data).where(eq(playlists.id, id))
}

export async function deletePlaylist(db: Database, id: number): Promise<void> {
  await db.delete(playlists).where(eq(playlists.id, id))
}

export async function replacePlaylistTracks(
  db: Database,
  playlistId: number,
  tracks: PlaylistTrackInsert[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(playlistTracks).where(eq(playlistTracks.playlistId, playlistId))
    if (tracks.length > 0) {
      await tx.insert(playlistTracks).values(
        tracks.map((t, i) => ({
          playlistId,
          artistName: t.artistName,
          trackName: t.trackName ?? null,
          mbid: t.mbid ?? null,
          spotifyUri: t.spotifyUri ?? null,
          deezerId: t.deezerId ?? null,
          localPath: t.localPath ?? null,
          position: i,
        })),
      )
    }
  })
}
