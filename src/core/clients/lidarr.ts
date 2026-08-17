import { envConfig } from '@/config/env'
import { timeoutSecondsWithDefaultToMs } from '@/core/providers/timeout'
import type { ServiceTestResult } from '@/core/types'
import { errMsg } from '@/core/validation'
import { createHttpClient, HttpTimeoutError } from './http'

export type LidarrArtist = {
  id: number
  artistName: string
  foreignArtistId: string // This is the MBID
  qualityProfileId: number
  rootFolderPath: string
  monitored: boolean
  status: string
  genres?: string[]
}

export type QualityProfile = {
  id: number
  name: string
}

export type MetadataProfile = {
  id: number
  name: string
}

export type RootFolder = {
  id: number
  path: string
  freeSpace: number
}

export type LidarrAlbum = {
  id: number
  title: string
  artistId: number
  foreignAlbumId: string // MBID
  monitored: boolean
  albumType: string
  statistics?: {
    trackCount: number
    trackFileCount: number
    percentOfTracks: number
  }
}

export type LidarrWantedMissing = {
  id: number
  title: string
  artistId?: number
  foreignAlbumId?: string
  artist?: {
    id?: number
    artistName?: string
    foreignArtistId?: string
  }
  artistName?: string
  foreignArtistId?: string
}

export type LidarrCommand = {
  id: number
  name: string
  status: string
}

export type AddArtistOptions = {
  monitorOption?: 'all' | 'new' | 'none'
}

// digarr's monitor vocabulary is not Lidarr's. MonitorTypes has no `new`
// member, so forwarding it verbatim fails JSON deserialization with a 400
// before validation even runs (#611). Keep every digarr value mapped here --
// the `satisfies` makes a new one a compile error rather than a runtime 400.
export const LIDARR_MONITOR_TYPES = {
  all: 'all',
  new: 'future',
  none: 'none',
} as const satisfies Record<NonNullable<AddArtistOptions['monitorOption']>, string>

// Lidarr's /api/v1/artist has no pagination, so a large library arrives as one
// oversized response (7100 artists is ~54MB / ~83s). The 10s client default
// cannot cover that; this is the budget for that one call.
const DEFAULT_ARTIST_LIST_TIMEOUT_SECONDS = 120

export type LidarrClientOptions = {
  listTimeoutMs?: number
}

export function createLidarrClient(
  url: string,
  apiKey: string,
  skipTlsVerify = false,
  opts: LidarrClientOptions = {},
) {
  const http = createHttpClient({
    baseUrl: url,
    headers: { 'X-Api-Key': apiKey },
    skipTlsVerify,
  })

  const listTimeoutMs =
    opts.listTimeoutMs ??
    timeoutSecondsWithDefaultToMs(
      envConfig.lidarrTimeoutSeconds,
      DEFAULT_ARTIST_LIST_TIMEOUT_SECONDS,
    )

  // Caches to avoid repeated API calls within a client instance.
  let rootFolderCache: RootFolder[] | null = null
  let qualityProfileCache: QualityProfile[] | null = null
  let metadataProfileCache: MetadataProfile[] | null = null

  // Strip to only the fields we need - the full Lidarr response includes
  // images, statistics, albums, links, ratings etc. that we don't use,
  // which wastes significant memory for large libraries.
  function mapArtist(a: Record<string, unknown>): LidarrArtist {
    return {
      id: a.id as number,
      artistName: a.artistName as string,
      foreignArtistId: a.foreignArtistId as string,
      qualityProfileId: a.qualityProfileId as number,
      rootFolderPath: a.rootFolderPath as string,
      monitored: a.monitored as boolean,
      status: a.status as string,
      genres: a.genres as string[] | undefined,
    }
  }

  async function getArtists(): Promise<LidarrArtist[]> {
    try {
      // No retries: an endpoint that reliably outruns the budget will not
      // succeed on a second attempt, and every attempt costs Lidarr another
      // full serialization of the library.
      const raw = await http.get<Record<string, unknown>[]>('/api/v1/artist', {
        timeout: listTimeoutMs,
        retries: 0,
      })
      return raw.map(mapArtist)
    } catch (err: unknown) {
      if (err instanceof HttpTimeoutError) {
        throw new Error(
          `${err.message}; raise DIGARR_LIDARR_TIMEOUT_SECONDS if your Lidarr library is large`,
        )
      }
      throw err
    }
  }

  // Lidarr's AllArtists accepts an mbId filter, so a single-artist lookup does
  // not need the whole library. The find() guards versions that predate the
  // filter: Lidarr ignores unknown query params rather than rejecting them, so
  // those answer with every artist and raw[0] would be the wrong one.
  async function findArtistByMbid(mbid: string): Promise<LidarrArtist | null> {
    const encoded = new URLSearchParams({ mbId: mbid }).toString()
    const raw = await http.get<Record<string, unknown>[]>(`/api/v1/artist?${encoded}`)
    return raw.map(mapArtist).find((a) => a.foreignArtistId === mbid) ?? null
  }

  function lookupArtist(term: string): Promise<LidarrArtist[]> {
    const encoded = new URLSearchParams({ term }).toString()
    return http.get<LidarrArtist[]>(`/api/v1/artist/lookup?${encoded}`)
  }

  async function getQualityProfiles(): Promise<QualityProfile[]> {
    if (qualityProfileCache !== null) return qualityProfileCache
    const profiles = await http.get<QualityProfile[]>('/api/v1/qualityprofile')
    qualityProfileCache = profiles
    return profiles
  }

  async function getMetadataProfiles(): Promise<MetadataProfile[]> {
    if (metadataProfileCache !== null) return metadataProfileCache
    const profiles = await http.get<MetadataProfile[]>('/api/v1/metadataprofile')
    metadataProfileCache = profiles
    return profiles
  }

  // Preferences default profile ids to 1, but Lidarr never reuses id 1 once
  // the stock profile is deleted -- non-interactive adds (auto-approve,
  // subscriptions, bulk) would then fail with "Quality Profile does not
  // exist". Mirror the approve dialog: snap unknown ids to the first
  // available profile.
  function snapProfileId(
    requested: number,
    profiles: { id: number; name: string }[],
    kind: string,
  ): number {
    const first = profiles[0]
    if (!first) throw new Error(`No ${kind} profiles configured in Lidarr`)
    if (profiles.some((p) => p.id === requested)) return requested
    console.warn(
      `[lidarr] ${kind} profile id ${requested} not found, falling back to "${first.name}" (id ${first.id})`,
    )
    return first.id
  }

  async function getRootFolders(): Promise<RootFolder[]> {
    if (rootFolderCache !== null) return rootFolderCache
    const folders = await http.get<RootFolder[]>('/api/v1/rootfolder')
    rootFolderCache = folders
    return folders
  }

  async function addArtist(
    foreignArtistId: string,
    artistName: string,
    qualityProfileId: number,
    metadataProfileId: number,
    rootFolderId?: number | null,
    options?: AddArtistOptions,
  ): Promise<LidarrArtist> {
    const [folders, qualityProfiles, metadataProfiles] = await Promise.all([
      getRootFolders(),
      getQualityProfiles(),
      getMetadataProfiles(),
    ])
    if (folders.length === 0) {
      throw new Error('No root folders configured in Lidarr')
    }
    const folder = rootFolderId == null ? folders[0] : folders.find((f) => f.id === rootFolderId)
    if (!folder) {
      throw new Error(`Root folder with id ${rootFolderId} not found`)
    }

    const monitorOption = options?.monitorOption ?? 'none'

    return http.post<LidarrArtist>('/api/v1/artist', {
      foreignArtistId,
      artistName,
      qualityProfileId: snapProfileId(qualityProfileId, qualityProfiles, 'quality'),
      metadataProfileId: snapProfileId(metadataProfileId, metadataProfiles, 'metadata'),
      rootFolderPath: folder.path,
      monitored: true,
      addOptions: {
        monitor: LIDARR_MONITOR_TYPES[monitorOption],
        // Derived from digarr's value, not the mapped one, so a future value
        // that maps onto `all` does not silently inherit the search.
        searchForMissingAlbums: monitorOption === 'all',
      },
    })
  }

  async function getAlbums(artistId: number): Promise<LidarrAlbum[]> {
    const raw = await http.get<Record<string, unknown>[]>(`/api/v1/album?artistId=${artistId}`)
    // Strip to only the fields we need - Lidarr album responses include
    // full track lists, images, and other metadata we don't use.
    return raw.map((a) => ({
      id: a.id as number,
      title: a.title as string,
      artistId: a.artistId as number,
      foreignAlbumId: a.foreignAlbumId as string,
      monitored: a.monitored as boolean,
      albumType: a.albumType as string,
      statistics:
        a.statistics != null
          ? (a.statistics as {
              trackCount: number
              trackFileCount: number
              percentOfTracks: number
            })
          : undefined,
    }))
  }

  async function getWantedMissing(): Promise<LidarrWantedMissing[]> {
    const raw = await http.get<unknown>('/api/v1/wanted/missing')
    const items = Array.isArray(raw)
      ? raw
      : raw && typeof raw === 'object' && Array.isArray((raw as { records?: unknown }).records)
        ? ((raw as { records: unknown[] }).records as Record<string, unknown>[])
        : []

    return items.map((album) => ({
      id: album.id as number,
      title: album.title as string,
      artistId: album.artistId as number | undefined,
      foreignAlbumId: album.foreignAlbumId as string | undefined,
      artist:
        album.artist && typeof album.artist === 'object'
          ? {
              id: (album.artist as Record<string, unknown>).id as number | undefined,
              artistName: (album.artist as Record<string, unknown>).artistName as
                | string
                | undefined,
              foreignArtistId: (album.artist as Record<string, unknown>).foreignArtistId as
                | string
                | undefined,
            }
          : undefined,
      artistName: album.artistName as string | undefined,
      foreignArtistId: album.foreignArtistId as string | undefined,
    }))
  }

  // Lidarr's per-item PUT endpoints replace the full resource: a partial body
  // deserializes missing fields as null and trips NOT NULL constraints
  // (e.g. Albums.ForeignAlbumId -> HTTP 409). The bulk monitor/editor
  // endpoints only apply the fields provided, so use them for flag flips.
  function setAlbumsMonitored(albumIds: number[], monitored: boolean): Promise<LidarrAlbum[]> {
    return http.put<LidarrAlbum[]>('/api/v1/album/monitor', { albumIds, monitored })
  }

  function setArtistsMonitored(artistIds: number[], monitored: boolean): Promise<LidarrArtist[]> {
    return http.put<LidarrArtist[]>('/api/v1/artist/editor', { artistIds, monitored })
  }

  function triggerCommand(name: string, body?: Record<string, unknown>): Promise<LidarrCommand> {
    return http.post<LidarrCommand>('/api/v1/command', { name, ...body })
  }

  async function testConnection(): Promise<ServiceTestResult> {
    try {
      const profiles = await http.get<QualityProfile[]>('/api/v1/qualityprofile')
      return {
        success: true,
        message: `Connected to Lidarr - ${profiles.length} quality profile(s) found`,
        details: { profileCount: profiles.length },
      }
    } catch (err: unknown) {
      return { success: false, message: errMsg(err) }
    }
  }

  return {
    getArtists,
    findArtistByMbid,
    lookupArtist,
    addArtist,
    getAlbums,
    getWantedMissing,
    setAlbumsMonitored,
    setArtistsMonitored,
    triggerCommand,
    getQualityProfiles,
    getMetadataProfiles,
    getRootFolders,
    testConnection,
  }
}
