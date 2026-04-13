import type { ServiceTestResult } from '@/core/types'
import { errMsg } from '@/core/validation'
import { createHttpClient } from './http'

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

export function createLidarrClient(url: string, apiKey: string, skipTlsVerify = false) {
  const http = createHttpClient({
    baseUrl: url,
    headers: { 'X-Api-Key': apiKey },
    skipTlsVerify,
  })

  // Cache for root folders to avoid repeated API calls within a client instance.
  let rootFolderCache: RootFolder[] | null = null

  async function getArtists(): Promise<LidarrArtist[]> {
    const raw = await http.get<Record<string, unknown>[]>('/api/v1/artist')
    // Strip to only the fields we need -- the full Lidarr response includes
    // images, statistics, albums, links, ratings etc. that we don't use,
    // which wastes significant memory for large libraries.
    return raw.map((a) => ({
      id: a.id as number,
      artistName: a.artistName as string,
      foreignArtistId: a.foreignArtistId as string,
      qualityProfileId: a.qualityProfileId as number,
      rootFolderPath: a.rootFolderPath as string,
      monitored: a.monitored as boolean,
      status: a.status as string,
      genres: a.genres as string[] | undefined,
    }))
  }

  function lookupArtist(term: string): Promise<LidarrArtist[]> {
    const encoded = new URLSearchParams({ term }).toString()
    return http.get<LidarrArtist[]>(`/api/v1/artist/lookup?${encoded}`)
  }

  function getQualityProfiles(): Promise<QualityProfile[]> {
    return http.get<QualityProfile[]>('/api/v1/qualityprofile')
  }

  function getMetadataProfiles(): Promise<MetadataProfile[]> {
    return http.get<MetadataProfile[]>('/api/v1/metadataprofile')
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
    rootFolderId: number,
    options?: AddArtistOptions,
  ): Promise<LidarrArtist> {
    const folders = await getRootFolders()
    const folder = folders.find((f) => f.id === rootFolderId)
    if (!folder) {
      throw new Error(`Root folder with id ${rootFolderId} not found`)
    }

    const monitor = options?.monitorOption ?? 'all'

    return http.post<LidarrArtist>('/api/v1/artist', {
      foreignArtistId,
      artistName,
      qualityProfileId,
      metadataProfileId,
      rootFolderPath: folder.path,
      monitored: true,
      addOptions: {
        monitor,
        searchForMissingAlbums: monitor === 'all',
      },
    })
  }

  async function getAlbums(artistId: number): Promise<LidarrAlbum[]> {
    const raw = await http.get<Record<string, unknown>[]>(`/api/v1/album?artistId=${artistId}`)
    // Strip to only the fields we need -- Lidarr album responses include
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

  function updateArtist(id: number, data: Partial<LidarrArtist>): Promise<LidarrArtist> {
    return http.put<LidarrArtist>(`/api/v1/artist/${id}`, data)
  }

  function updateAlbum(id: number, data: { monitored: boolean }): Promise<LidarrAlbum> {
    return http.put<LidarrAlbum>(`/api/v1/album/${id}`, data)
  }

  function triggerCommand(name: string, body?: Record<string, unknown>): Promise<LidarrCommand> {
    return http.post<LidarrCommand>('/api/v1/command', { name, ...body })
  }

  async function testConnection(): Promise<ServiceTestResult> {
    try {
      const profiles = await http.get<QualityProfile[]>('/api/v1/qualityprofile')
      return {
        success: true,
        message: `Connected to Lidarr -- ${profiles.length} quality profile(s) found`,
        details: { profileCount: profiles.length },
      }
    } catch (err: unknown) {
      return { success: false, message: errMsg(err) }
    }
  }

  return {
    getArtists,
    lookupArtist,
    addArtist,
    getAlbums,
    getWantedMissing,
    updateArtist,
    updateAlbum,
    triggerCommand,
    getQualityProfiles,
    getMetadataProfiles,
    getRootFolders,
    testConnection,
  }
}
