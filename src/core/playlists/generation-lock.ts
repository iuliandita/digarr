const activePlaylists = new Set<number>()

export class PlaylistBusyError extends Error {
  constructor() {
    super('Playlist generation or export recovery is already running')
  }
}

export async function withPlaylistLock<T>(
  playlistId: number,
  action: () => Promise<T>,
): Promise<T> {
  if (activePlaylists.has(playlistId)) throw new PlaylistBusyError()
  activePlaylists.add(playlistId)
  try {
    return await action()
  } finally {
    activePlaylists.delete(playlistId)
  }
}
