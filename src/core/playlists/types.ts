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

export type LocalTrack = {
  name: string
  artist: string
  path: string
  duration?: number
}

export type MBRecording = {
  id: string
  title: string
  isrcs?: string[]
}

export type TrackResolverDeps = {
  spotifySearch?: (query: string, limit?: number) => Promise<SpotifySearchResult[]>
  deezerSearch?: (query: string, limit?: number) => Promise<DeezerTrackSearchResult[]>
  jellyfinSearch?: (artist: string) => Promise<LocalTrack[]>
  navidromeSearch?: (artist: string) => Promise<LocalTrack[]>
  plexSearch?: (artist: string) => Promise<LocalTrack[]>
  musicbrainzRecordings?: (artistMbid: string) => Promise<MBRecording[]>
}

export type TrackResolverConfig = {
  tracksPerArtist: number
  sourcePriority: ('local' | 'spotify' | 'deezer')[]
}
