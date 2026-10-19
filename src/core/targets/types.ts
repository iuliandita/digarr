import type { ServiceTestResult } from '@/core/types'
import type { ReleaseGroupTypes } from './lidarr-metadata-profile'

export type TargetCapability = 'addArtist' | 'addAlbum' | 'createPlaylist'

export const TARGET_TYPES = [
  'lidarr',
  'slskd',
  'spotify-playlist',
  'navidrome-playlist',
  'jellyfin-playlist',
  'emby-playlist',
  'plex-playlist',
  'export',
] as const
export type TargetType = (typeof TARGET_TYPES)[number]

export type TargetAddOptions = {
  followUpTargetId?: string
  retryExisting?: boolean
  monitorOption?: 'all' | 'new' | 'missing' | 'existing' | 'latest' | 'first' | 'none' | 'selected'
  tags?: number[]
  selectedAlbumIds?: string[]
  qualityProfileId?: number
  metadataProfileId?: number
  rootFolderId?: number
  /** Lidarr target the profile/folder IDs above were picked for (e.g. `lidarr-3`). */
  lidarrOptionsTargetId?: string
  userId?: number
  recommendationId?: number
  lidarrArtistId?: number
}

export type TargetResult = {
  success: boolean
  targetType: string
  targetId: number
  externalId?: number | string
  error?: string
  /** Non-fatal partial-failure note (e.g. artist added but album monitoring did not complete). */
  warning?: string
}

export type PlaylistItem = {
  artistName: string
  artistMbid: string
  trackName?: string
  trackMbid?: string
  spotifyUri?: string
}

export type PlaylistResult = {
  success: boolean
  targetType: string
  targetId: number
  playlistId?: string
  playlistName?: string
  itemsAdded?: number
  itemsSkipped?: number
  error?: string
}

export type PlaylistExportSession = {
  scope: string
  createPlaylist(
    name: string,
    onCreated: (playlistId: string) => Promise<void>,
  ): Promise<PlaylistResult>
  replacePlaylist(playlistId: string, name: string): Promise<PlaylistResult>
  readBackTrackCount?(playlistId: string): Promise<number>
}

export interface DestinationTarget {
  id: string
  name: string
  type: TargetType
  capabilities: TargetCapability[]
  linkedLidarrTargetId?: string

  addArtist?(
    artist: { mbid: string; name: string },
    options?: TargetAddOptions,
  ): Promise<TargetResult>

  addAlbum?(
    album: { artistMbid: string; artistName: string; releaseGroupMbid: string },
    options?: TargetAddOptions,
  ): Promise<TargetResult>

  /** Release-group MBIDs this target would never list, so `addAlbum` could not add them. */
  unaddableAlbums?(
    albums: Array<{ artistMbid: string; releaseGroupMbid: string; types: ReleaseGroupTypes }>,
  ): Promise<Set<string>>

  openPlaylistExportSession?(items: PlaylistItem[]): Promise<PlaylistExportSession>

  testConnection(): Promise<ServiceTestResult>
}

export type ExportableRecommendation = {
  artistName: string
  artistMbid: string
  genres: string[]
  score: number
  status: string
  aiReasoning?: string
  imageUrl?: string
  streamingUrls: Record<string, string>
  createdAt: string
  suggestedAlbum?: string
  recordingMbid?: string
  recordingTitle?: string
}

/** Resolve the best streaming URL for a recommendation, falling back to MusicBrainz. */
export function getStreamingUrl(rec: ExportableRecommendation): string {
  return (
    rec.streamingUrls.spotify ??
    rec.streamingUrls.youtube ??
    rec.streamingUrls.deezer ??
    `https://musicbrainz.org/artist/${rec.artistMbid}`
  )
}

/** DB row id of a target; destination ids are `<type>-<row id>`. */
export function targetDbId(destinationId: string): number | undefined {
  const id = Number(destinationId.slice(destinationId.lastIndexOf('-') + 1))
  return Number.isSafeInteger(id) ? id : undefined
}
