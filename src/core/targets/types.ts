import type { ServiceTestResult } from '@/core/types'

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
  monitorOption?: 'all' | 'new' | 'none' | 'selected'
  selectedAlbumIds?: string[]
  qualityProfileId?: number
  metadataProfileId?: number
  rootFolderId?: number
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
}

export type PlaylistItem = {
  artistName: string
  artistMbid: string
  trackName?: string
  trackMbid?: string
}

export type PlaylistResult = {
  success: boolean
  targetType: string
  targetId: number
  playlistId?: string
  playlistName?: string
  itemsAdded?: number
  error?: string
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

  createPlaylist?(
    name: string,
    items: PlaylistItem[],
    options?: { description?: string; public?: boolean; replace?: boolean },
  ): Promise<PlaylistResult>

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
