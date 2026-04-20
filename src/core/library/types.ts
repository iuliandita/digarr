export type HealthCheckId =
  | 'missing-metadata'
  | 'unmonitored'
  | 'missing-albums'
  | 'duplicate-artists'
  | 'genre-gaps'
  | 'image-gaps'
  | 'missing-wikidata'

export type HealthCheckSeverity = 'info' | 'warning' | 'error'

export type HealthCheckResult = {
  id: HealthCheckId
  name: string
  description: string
  severity: HealthCheckSeverity
  count: number
  items: HealthCheckItem[]
  fixable: boolean
}

export type HealthCheckItem = {
  artistId: number
  artistName: string
  mbid: string
  detail: string
}

export type HealthFixProgress = {
  checkId: HealthCheckId
  total: number
  completed: number
  failed: number
  status: 'running' | 'completed' | 'failed'
  errors: string[]
}

export type LibraryStats = {
  totalArtists: number
  totalAlbums: number
  monitoredArtists: number
  genreDistribution: Array<{ genre: string; count: number }>
  rootFolders: Array<{ path: string; freeSpace: number }>
}

export type LibraryHealthState = {
  checks: HealthCheckResult[]
  lastStartedAt: Date | null
  lastCompletedAt: Date | null
  lastError: string | null
}
