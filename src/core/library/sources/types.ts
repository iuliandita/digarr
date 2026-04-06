import type { ServiceTestResult } from '@/core/types'

export type LibrarySourceCapability = 'listArtists' | 'listAlbums'

export type LibraryArtist = {
  /** Plex ratingKey, Jellyfin Item ID, Lidarr id (as a string) */
  sourceArtistId: string
  name: string
  /** Populated when the source has a native MBID for this artist */
  mbid?: string
  /** Raw genres from the source -- no reconciliation */
  genres?: string[]
  /** Optional: source-reported album titles for Step 5 disambiguation */
  knownAlbumTitles?: string[]
}

export type LibraryAlbum = {
  sourceAlbumId: string
  sourceArtistId: string
  title: string
  /** Album release-group MBID if the source has it */
  mbid?: string
  releaseYear?: number
  primaryType?: 'Album' | 'EP' | 'Single' | 'Compilation' | 'Live' | 'Other'
}

/**
 * Drives sync ordering. High-quality sources sync first so their MBIDs anchor
 * name matches from low-quality sources.
 *
 * | Source   | mbidQuality |
 * | -------- | ----------- |
 * | Lidarr   | high        |
 * | Jellyfin | high        |
 * | Plex     | low         |
 * | Emby     | high        |
 */
export type MbidQuality = 'high' | 'low'

export interface LibrarySource {
  /** 'lidarr' | 'plex' | 'jellyfin' | 'emby' */
  id: string
  name: string
  capabilities: LibrarySourceCapability[]
  /** null = global config, non-null = per-user */
  userId: number | null
  mbidQuality: MbidQuality
  listArtists(): Promise<LibraryArtist[]>
  listAlbums?(sourceArtistId: string): Promise<LibraryAlbum[]>
  testConnection(): Promise<ServiceTestResult>
}
