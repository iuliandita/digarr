import { and, asc, eq } from 'drizzle-orm'
import type { Database, DbOrTx } from '@/db'
import { playlistExports, playlists, targets } from '@/db/schema'

export type PlaylistExportRow = typeof playlistExports.$inferSelect

function validateRemoteValue(value: string, field: string): void {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 2048) {
    throw new Error(`Invalid playlist export ${field}`)
  }
}

async function requireOwnedParents(
  tx: DbOrTx,
  userId: number,
  playlistId: number,
  targetId: number,
): Promise<void> {
  const [playlist] = await tx
    .select({ id: playlists.id })
    .from(playlists)
    .where(and(eq(playlists.id, playlistId), eq(playlists.userId, userId)))
    .for('update')
  const [target] = await tx
    .select({ id: targets.id })
    .from(targets)
    .where(and(eq(targets.id, targetId), eq(targets.userId, userId)))
    .for('update')
  if (!playlist || !target) throw new Error('Playlist export parents are not owned by this user')
}

function bindingKey(playlistId: number, targetId: number) {
  return and(eq(playlistExports.playlistId, playlistId), eq(playlistExports.targetId, targetId))
}

export async function getPlaylistExports(
  db: Database,
  userId: number,
  playlistId: number,
): Promise<PlaylistExportRow[]> {
  const rows = await db
    .select({ binding: playlistExports })
    .from(playlistExports)
    .innerJoin(playlists, eq(playlists.id, playlistExports.playlistId))
    .innerJoin(targets, eq(targets.id, playlistExports.targetId))
    .where(
      and(
        eq(playlistExports.playlistId, playlistId),
        eq(playlists.userId, userId),
        eq(targets.userId, userId),
      ),
    )
    .orderBy(asc(playlistExports.targetId))
  return rows.map((row) => row.binding)
}

export async function getPlaylistExport(
  db: Database,
  userId: number,
  playlistId: number,
  targetId: number,
): Promise<PlaylistExportRow | null> {
  const rows = await getPlaylistExports(db, userId, playlistId)
  return rows.find((row) => row.targetId === targetId) ?? null
}

export async function reservePlaylistExport(
  db: Database,
  userId: number,
  playlistId: number,
  targetId: number,
  remoteScope: string,
): Promise<{ created: boolean; binding: PlaylistExportRow }> {
  validateRemoteValue(remoteScope, 'scope')
  return db.transaction(async (tx) => {
    await requireOwnedParents(tx, userId, playlistId, targetId)
    const [created] = await tx
      .insert(playlistExports)
      .values({ playlistId, targetId, remoteScope })
      .onConflictDoNothing({ target: [playlistExports.playlistId, playlistExports.targetId] })
      .returning()
    if (created) return { created: true, binding: created }
    const [binding] = await tx
      .select()
      .from(playlistExports)
      .where(bindingKey(playlistId, targetId))
    if (!binding) throw new Error('Playlist export reservation could not be reloaded')
    return { created: false, binding }
  })
}

export async function linkPlaylistExport(
  db: Database,
  userId: number,
  playlistId: number,
  targetId: number,
  remoteScope: string,
  remotePlaylistId: string,
): Promise<void> {
  validateRemoteValue(remoteScope, 'scope')
  validateRemoteValue(remotePlaylistId, 'remote playlist ID')
  await db.transaction(async (tx) => {
    await requireOwnedParents(tx, userId, playlistId, targetId)
    const updated = await tx
      .update(playlistExports)
      .set({ remotePlaylistId, state: 'linked', updatedAt: new Date() })
      .where(
        and(
          bindingKey(playlistId, targetId),
          eq(playlistExports.remoteScope, remoteScope),
          eq(playlistExports.state, 'creating'),
        ),
      )
      .returning({ id: playlistExports.id })
    if (updated.length !== 1) throw new Error('Playlist export checkpoint was not persisted')
  })
}

export async function markPlaylistExportRecoveryRequired(
  db: Database,
  userId: number,
  playlistId: number,
  targetId: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    await requireOwnedParents(tx, userId, playlistId, targetId)
    await tx
      .update(playlistExports)
      .set({ state: 'recovery_required', updatedAt: new Date() })
      .where(and(bindingKey(playlistId, targetId), eq(playlistExports.state, 'creating')))
  })
}

export async function resetPlaylistExport(
  db: Database,
  userId: number,
  playlistId: number,
  targetId: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    await requireOwnedParents(tx, userId, playlistId, targetId)
    await tx.delete(playlistExports).where(bindingKey(playlistId, targetId))
  })
}
