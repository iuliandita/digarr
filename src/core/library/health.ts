import PQueue from 'p-queue'
import type { LidarrAlbum, LidarrArtist } from '@/core/clients/lidarr'
import type {
  HealthCheckId,
  HealthCheckItem,
  HealthCheckResult,
  HealthFixProgress,
  LibraryStats,
} from '@/core/library/types'
import { errMsg } from '@/core/validation'

// ---------------------------------------------------------------------------
// Dependency types
// ---------------------------------------------------------------------------

type ArtistCacheEntry = {
  id: number
  mbid: string
  name: string
  genres: string[] | null
  tags: string[] | null
  imageUrl: string | null
  streamingUrls: Record<string, string> | null
}

type HealthServiceDeps = {
  lidarrClient: {
    getArtists: () => Promise<LidarrArtist[]>
    getAlbums: (artistId: number) => Promise<LidarrAlbum[]>
    lookupArtist: (term: string) => Promise<unknown[]>
    updateArtist: (id: number, data: Partial<LidarrArtist>) => Promise<LidarrArtist>
    triggerCommand: (name: string, body?: Record<string, unknown>) => Promise<unknown>
    getRootFolders: () => Promise<Array<{ id: number; path: string; freeSpace: number }>>
  }
  artistCache: {
    getAll: () => Promise<ArtistCacheEntry[]>
    updateImageUrl?: (mbid: string, imageUrl: string) => Promise<void>
  }
}

// ---------------------------------------------------------------------------
// Check metadata
// ---------------------------------------------------------------------------

const CHECK_META: Record<
  HealthCheckId,
  { name: string; description: string; severity: 'info' | 'warning' | 'error'; fixable: boolean }
> = {
  'missing-metadata': {
    name: 'Missing Metadata',
    description: 'Artists in Lidarr with no genres and no image in local cache.',
    severity: 'warning',
    fixable: true,
  },
  unmonitored: {
    name: 'Unmonitored Artists',
    description: 'Artists in Lidarr that are not monitored.',
    severity: 'info',
    fixable: true,
  },
  'missing-albums': {
    name: 'Missing Album Files',
    description: 'Monitored artists with albums that have tracks but no downloaded files.',
    severity: 'warning',
    fixable: true,
  },
  'duplicate-artists': {
    name: 'Duplicate Artists',
    description: 'Artists with the same name under different MBIDs.',
    severity: 'warning',
    fixable: false,
  },
  'genre-gaps': {
    name: 'Genre Gaps',
    description: 'Artists with no genre tags in either Lidarr or local cache.',
    severity: 'warning',
    fixable: true,
  },
  'image-gaps': {
    name: 'Image Gaps',
    description: 'Artists in local cache with no image URL.',
    severity: 'info',
    fixable: true,
  },
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class LibraryHealthService {
  private deps: HealthServiceDeps
  private cachedResults: HealthCheckResult[] | null = null
  private _scanning = false

  constructor(deps: HealthServiceDeps) {
    this.deps = deps
  }

  get scanning(): boolean {
    return this._scanning
  }

  // -------------------------------------------------------------------------
  // startScan -- fire-and-forget, returns immediately
  // -------------------------------------------------------------------------

  startScan(): void {
    if (this._scanning) return
    this._scanning = true
    this.runChecks()
      .catch((err) => console.error('[library-health] scan failed:', err))
      .finally(() => {
        this._scanning = false
      })
  }

  // -------------------------------------------------------------------------
  // runChecks
  // -------------------------------------------------------------------------

  async runChecks(): Promise<HealthCheckResult[]> {
    const [lidarrArtists, cachedArtists] = await Promise.all([
      this.deps.lidarrClient.getArtists(),
      this.deps.artistCache.getAll(),
    ])

    const cachedByMbid = new Map(cachedArtists.map((a) => [a.mbid, a]))

    const monitoredArtists = lidarrArtists.filter((a) => a.monitored)

    const results: HealthCheckResult[] = [
      this.checkMissingMetadata(lidarrArtists, cachedByMbid),
      this.checkUnmonitored(lidarrArtists),
      await this.checkMissingAlbums(monitoredArtists),
      this.checkDuplicateArtists(lidarrArtists),
      this.checkGenreGaps(lidarrArtists, cachedByMbid),
      this.checkImageGaps(cachedArtists, lidarrArtists),
    ]

    this.cachedResults = results
    return results
  }

  // -------------------------------------------------------------------------
  // getLastResults
  // -------------------------------------------------------------------------

  getLastResults(): HealthCheckResult[] | null {
    return this.cachedResults
  }

  // -------------------------------------------------------------------------
  // fixCheck
  // -------------------------------------------------------------------------

  async fixCheck(checkId: HealthCheckId): Promise<HealthFixProgress> {
    if (checkId === 'duplicate-artists') {
      throw new Error('duplicate-artists check is not fixable')
    }

    const results = this.cachedResults
    const check = results?.find((r) => r.id === checkId)
    const items: HealthCheckItem[] = check?.items ?? []

    const progress: HealthFixProgress = {
      checkId,
      total: items.length,
      completed: 0,
      failed: 0,
      status: 'running',
      errors: [],
    }

    const queue = new PQueue({ concurrency: 1, interval: 1000, intervalCap: 1 })

    for (const item of items) {
      await queue.add(async () => {
        try {
          await this.applyFix(checkId, item)
          progress.completed++
        } catch (err: unknown) {
          progress.failed++
          progress.errors.push(`${item.artistName}: ${errMsg(err)}`)
        }
      })
    }

    await queue.onIdle()

    progress.status = progress.failed === 0 ? 'completed' : 'failed'
    return progress
  }

  // -------------------------------------------------------------------------
  // getStats
  // -------------------------------------------------------------------------

  async getStats(): Promise<LibraryStats> {
    const [lidarrArtists, rootFolders] = await Promise.all([
      this.deps.lidarrClient.getArtists(),
      this.deps.lidarrClient.getRootFolders(),
    ])

    const monitoredCount = lidarrArtists.filter((a) => a.monitored).length

    const genreCounts = new Map<string, number>()
    for (const artist of lidarrArtists) {
      for (const genre of artist.genres ?? []) {
        genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1)
      }
    }

    const genreDistribution = [...genreCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([genre, count]) => ({ genre, count }))

    return {
      totalArtists: lidarrArtists.length,
      totalAlbums: 0,
      monitoredArtists: monitoredCount,
      genreDistribution,
      rootFolders: rootFolders.map(({ path, freeSpace }) => ({ path, freeSpace })),
    }
  }

  // -------------------------------------------------------------------------
  // Private: individual checks
  // -------------------------------------------------------------------------

  private checkMissingMetadata(
    artists: LidarrArtist[],
    cachedByMbid: Map<string, ArtistCacheEntry>,
  ): HealthCheckResult {
    const meta = CHECK_META['missing-metadata']
    const items: HealthCheckItem[] = []

    for (const artist of artists) {
      const hasGenres = (artist.genres?.length ?? 0) > 0
      const cached = cachedByMbid.get(artist.foreignArtistId)
      const hasImage = cached?.imageUrl != null

      if (!hasGenres && !hasImage) {
        items.push({
          artistId: artist.id,
          artistName: artist.artistName,
          mbid: artist.foreignArtistId,
          detail: 'Missing: genres, image',
        })
      }
    }

    return { ...meta, id: 'missing-metadata', count: items.length, items }
  }

  private checkUnmonitored(artists: LidarrArtist[]): HealthCheckResult {
    const meta = CHECK_META.unmonitored
    const items: HealthCheckItem[] = artists
      .filter((a) => !a.monitored)
      .map((a) => ({
        artistId: a.id,
        artistName: a.artistName,
        mbid: a.foreignArtistId,
        detail: 'Not monitored',
      }))

    return { ...meta, id: 'unmonitored', count: items.length, items }
  }

  private async checkMissingAlbums(monitoredArtists: LidarrArtist[]): Promise<HealthCheckResult> {
    const meta = CHECK_META['missing-albums']
    const items: HealthCheckItem[] = []

    // Rate-limit album fetches so we don't saturate the event loop or hammer Lidarr
    const queue = new PQueue({ concurrency: 2, interval: 200, intervalCap: 2 })

    for (const artist of monitoredArtists) {
      queue.add(async () => {
        try {
          const albums = await this.deps.lidarrClient.getAlbums(artist.id)
          const missingCount = albums.filter(
            (album) =>
              album.monitored &&
              (album.statistics?.trackFileCount ?? 0) === 0 &&
              (album.statistics?.trackCount ?? 0) > 0,
          ).length

          if (missingCount > 0) {
            items.push({
              artistId: artist.id,
              artistName: artist.artistName,
              mbid: artist.foreignArtistId,
              detail: `${missingCount} monitored album${missingCount === 1 ? '' : 's'} with no files`,
            })
          }
        } catch {
          // skip individual artist failures
        }
      })
    }

    await queue.onIdle()
    return { ...meta, id: 'missing-albums', count: items.length, items }
  }

  private checkDuplicateArtists(artists: LidarrArtist[]): HealthCheckResult {
    const meta = CHECK_META['duplicate-artists']
    const nameMap = new Map<string, LidarrArtist[]>()

    for (const artist of artists) {
      const key = artist.artistName.toLowerCase()
      const existing = nameMap.get(key) ?? []
      existing.push(artist)
      nameMap.set(key, existing)
    }

    const items: HealthCheckItem[] = []
    for (const group of nameMap.values()) {
      if (group.length < 2) continue
      // Show one entry per duplicate group, list MBIDs in detail
      const first = group[0] as LidarrArtist
      const mbids = group.map((a) => a.foreignArtistId.slice(0, 8)).join(', ')
      items.push({
        artistId: first.id,
        artistName: first.artistName,
        mbid: first.foreignArtistId,
        detail: `${group.length} entries (${mbids})`,
      })
    }

    return { ...meta, id: 'duplicate-artists', count: items.length, items }
  }

  private checkGenreGaps(
    artists: LidarrArtist[],
    cachedByMbid: Map<string, ArtistCacheEntry>,
  ): HealthCheckResult {
    const meta = CHECK_META['genre-gaps']
    const items: HealthCheckItem[] = []

    for (const artist of artists) {
      const lidarrHasGenres = (artist.genres?.length ?? 0) > 0
      const cached = cachedByMbid.get(artist.foreignArtistId)
      const cacheHasGenres = (cached?.genres?.length ?? 0) > 0

      if (!lidarrHasGenres && !cacheHasGenres) {
        items.push({
          artistId: artist.id,
          artistName: artist.artistName,
          mbid: artist.foreignArtistId,
          detail: 'No genre tags',
        })
      }
    }

    return { ...meta, id: 'genre-gaps', count: items.length, items }
  }

  private checkImageGaps(
    cachedArtists: ArtistCacheEntry[],
    lidarrArtists: LidarrArtist[],
  ): HealthCheckResult {
    const meta = CHECK_META['image-gaps']
    const lidarrByMbid = new Map(lidarrArtists.map((a) => [a.foreignArtistId, a]))

    const items: HealthCheckItem[] = cachedArtists
      .filter((a) => a.imageUrl == null)
      .map((a) => {
        const lidarr = lidarrByMbid.get(a.mbid)
        return {
          artistId: lidarr?.id ?? 0,
          artistName: a.name,
          mbid: a.mbid,
          detail: 'No image',
        }
      })

    return { ...meta, id: 'image-gaps', count: items.length, items }
  }

  // -------------------------------------------------------------------------
  // Private: fix dispatch
  // -------------------------------------------------------------------------

  private async applyFix(checkId: HealthCheckId, item: HealthCheckItem): Promise<void> {
    switch (checkId) {
      case 'missing-metadata':
      case 'genre-gaps':
        await this.deps.lidarrClient.triggerCommand('RefreshArtist', { artistId: item.artistId })
        break

      case 'unmonitored':
        await this.deps.lidarrClient.updateArtist(item.artistId, { monitored: true })
        break

      case 'missing-albums':
        await this.deps.lidarrClient.triggerCommand('ArtistSearch', { artistId: item.artistId })
        break

      case 'image-gaps': {
        const results = await this.deps.lidarrClient.lookupArtist(`lidarr:${item.mbid}`)
        const imageUrl = extractImageUrl(results)
        if (imageUrl && this.deps.artistCache.updateImageUrl) {
          await this.deps.artistCache.updateImageUrl(item.mbid, imageUrl)
        }
        break
      }

      case 'duplicate-artists':
        throw new Error('not fixable')
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractImageUrl(results: unknown[]): string | null {
  for (const result of results) {
    if (typeof result !== 'object' || result === null) continue
    const r = result as Record<string, unknown>

    // Look for images array (Lidarr lookup format -- remoteUrl is the CDN URL)
    if (Array.isArray(r.images)) {
      for (const img of r.images as Array<Record<string, unknown>>) {
        if (img.coverType === 'poster' && typeof img.remoteUrl === 'string') return img.remoteUrl
      }
      for (const img of r.images as Array<Record<string, unknown>>) {
        if (img.coverType === 'fanart' && typeof img.remoteUrl === 'string') return img.remoteUrl
      }
      for (const img of r.images as Array<Record<string, unknown>>) {
        if (img.coverType !== 'clearlogo' && typeof img.remoteUrl === 'string') return img.remoteUrl
      }
    }

    // Direct posterUrl / fanartUrl fields
    if (typeof r.posterUrl === 'string') return r.posterUrl
    if (typeof r.fanartUrl === 'string') return r.fanartUrl
  }
  return null
}
