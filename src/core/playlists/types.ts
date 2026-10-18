import type { LibraryTrack } from '@/core/types'

export type PlaylistArtistOutcome = {
  artistName: string
  artistMbid?: string
  status: 'resolved' | 'unmatched' | 'unavailable' | 'error' | 'limited'
  resolvedTrackCount: number
  includedTrackCount: number
}

export type PlaylistGenerationSummary = {
  requestedArtistCount: number
  resolvedArtistCount: number
  includedArtistCount: number
  trackCount: number
  outcomes: PlaylistArtistOutcome[]
}

export type PlaylistExportOutcome = {
  targetId: number
  targetName: string
  targetType: string
  status: 'submitted' | 'partial' | 'failed'
  /** True only when a bounded read-back matched the submitted track count. */
  verified: boolean
  itemsAdded?: number
  itemsSkipped?: number
  error?: string
}

export type ResolvedTrack = {
  artistName: string
  trackName: string
  mbid?: string
  spotifyUri?: string
  deezerId?: string
  localPath?: string
  source: 'local' | 'spotify' | 'deezer' | 'musicbrainz'
}

export type SpotifySearchResult = {
  name: string
  artists: string[]
  uri: string
  popularity: number
}

export type DeezerTrackSearchResult = {
  id: string
  name: string
  artists: string[]
  rank: number
}

export type LocalTrack = LibraryTrack

export type MBRecording = {
  id: string
  title: string
  isrcs?: string[]
}

export type TrackResolverDeps = {
  spotifySearch?: (query: string, limit?: number) => Promise<SpotifySearchResult[]>
  deezerSearch?: (query: string, limit?: number) => Promise<DeezerTrackSearchResult[]>
  jellyfinSearch?: (artist: string) => Promise<LocalTrack[]>
  embySearch?: (artist: string) => Promise<LocalTrack[]>
  navidromeSearch?: (artist: string) => Promise<LocalTrack[]>
  plexSearch?: (artist: string) => Promise<LocalTrack[]>
  musicbrainzRecordings?: (artistMbid: string) => Promise<MBRecording[]>
}

export type TrackResolverConfig = {
  tracksPerArtist: number
  sourcePriority: ('local' | 'spotify' | 'deezer')[]
}
