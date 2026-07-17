// Shared query and mapping helpers for the MediaBrowser API family (Jellyfin,
// Emby). Both engines expose the same /Artists and /Users/{id}/Items endpoints
// and identical item shapes; only auth headers and Jellyfin's username
// resolution differ, so those stay in the per-client factories.

export type MediaBrowserArtist = {
  name: string
  id: string
  mbid?: string
  genres: string[]
  playCount: number
  isFavorite: boolean
}

export type MediaBrowserLibraryArtist = {
  id: string
  name: string
  mbid?: string
  genres: string[]
}

export type MediaBrowserLibraryAlbum = {
  id: string
  artistId: string
  title: string
  mbid?: string
  releaseYear?: number
  primaryType?: 'Album'
}

export type MediaBrowserRecentTrack = {
  artistName: string
  trackName: string
  datePlayed: string
}

export type MediaBrowserLibrary = {
  id: string
  name: string
}

type RawItem = Record<string, unknown>

// MusicArtist items are server-global, so ParentId on the generic Items
// endpoint does not scope them - the dedicated /Artists endpoint does.
export function scopedArtistsPath(
  userId: string,
  libraryId: string,
  extra: Record<string, string>,
): string {
  const params = new URLSearchParams({
    ParentId: libraryId,
    UserId: userId,
    EnableUserData: 'true',
    ...extra,
  })
  return `/Artists?${params.toString()}`
}

function providerId(item: RawItem, key: string): string | undefined {
  return (item.ProviderIds as Record<string, string> | undefined)?.[key]
}

/**
 * Map a MusicArtist item from a top/favorite query. `favoriteFallback` is the
 * value used when the item carries no UserData.IsFavorite flag: `false` for
 * play-count queries, `true` for favorite queries.
 */
export function mapArtist(item: RawItem, favoriteFallback: boolean): MediaBrowserArtist {
  const userData = item.UserData as { PlayCount?: number; IsFavorite?: boolean } | undefined
  return {
    name: item.Name as string,
    id: item.Id as string,
    mbid: providerId(item, 'MusicBrainzArtist'),
    genres: (item.Genres as string[] | undefined) ?? [],
    playCount: userData?.PlayCount ?? 0,
    isFavorite: userData?.IsFavorite ?? favoriteFallback,
  }
}

/**
 * Map a MusicArtist item for full-library sync. `trimMbid` reflects the
 * per-client convention: Jellyfin trims and drops empty MBIDs, Emby passes the
 * raw ProviderIds value through unchanged.
 */
export function mapLibraryArtist(item: RawItem, trimMbid: boolean): MediaBrowserLibraryArtist {
  const raw = providerId(item, 'MusicBrainzArtist')
  return {
    id: item.Id as string,
    name: item.Name as string,
    mbid: trimMbid ? raw?.trim() || undefined : raw,
    genres: (item.Genres as string[] | undefined) ?? [],
  }
}

/** Map a MusicAlbum item. `trimMbid` follows the same convention as above. */
export function mapAlbum(
  item: RawItem,
  artistId: string,
  trimMbid: boolean,
): MediaBrowserLibraryAlbum {
  const raw = providerId(item, 'MusicBrainzReleaseGroup')
  return {
    id: item.Id as string,
    artistId,
    title: item.Name as string,
    mbid: trimMbid ? raw?.trim() || undefined : raw,
    releaseYear: item.ProductionYear as number | undefined,
    primaryType: 'Album',
  }
}

export function mapRecentTrack(item: RawItem): MediaBrowserRecentTrack {
  const artistName =
    (item.AlbumArtist as string) ||
    ((item.Artists as string[] | undefined)?.[0] ?? 'Unknown Artist')
  const userData = item.UserData as { LastPlayedDate?: string } | undefined
  return {
    artistName,
    trackName: item.Name as string,
    datePlayed: userData?.LastPlayedDate ?? new Date().toISOString(),
  }
}

/** Filter music views to the CollectionType 'music' subset. */
export function toMusicLibraries(
  items: Array<{ Id: string; Name: string; CollectionType?: string }> | undefined,
): MediaBrowserLibrary[] {
  return (items ?? [])
    .filter((v) => v.CollectionType === 'music')
    .map((v) => ({ id: v.Id, name: v.Name }))
}
