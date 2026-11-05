import type { LibraryTrack, ServiceTestResult } from '@/core/types'
import { errMsg } from '@/core/validation'
import { createHttpClient } from './http'
import { collectLibraryPages } from './library-paging'
import {
  artistListPath,
  type MediaBrowserLibrary,
  type MediaBrowserLibraryAlbum,
  type MediaBrowserLibraryArtist,
  mapAlbum,
  mapArtist,
  mapLibraryArtist,
  mapLibraryTracks,
  mapRecentTrack,
  scopedArtistsPath,
  toMusicLibraries,
  trackSearchLimit,
  trackSearchPath,
} from './media-browser'
import { mediaServerTargetPolicy } from './media-server-policy'
import { createMediaServerQueue } from './media-server-queue'

export type EmbyMusicLibrary = MediaBrowserLibrary

const LIBRARY_PAGE_SIZE = 200

export function createEmbyClient(
  url: string,
  apiKey: string,
  userId: string,
  options?: { baseUrl?: string; skipTlsVerify?: boolean; libraryId?: string | null },
) {
  const configuredLibraryId = options?.libraryId?.trim() || null

  const http = createHttpClient({
    baseUrl: options?.baseUrl ?? url,
    headers: {
      'X-Emby-Token': apiKey,
    },
    skipTlsVerify: options?.skipTlsVerify,
    targetPolicy: mediaServerTargetPolicy(),
  })

  const queue = createMediaServerQueue()

  function get<T>(path: string): Promise<T> {
    return queue.add(() => http.get<T>(path)) as Promise<T>
  }

  function getLibraryItems<T>(
    kind: 'artist' | 'album',
    pathForPage: (startIndex: number) => string,
    mapItem: (item: Record<string, unknown>) => T,
  ): Promise<T[]> {
    return collectLibraryPages(
      { server: 'Emby', kind, totalField: 'TotalRecordCount' },
      LIBRARY_PAGE_SIZE,
      async (startIndex) => {
        const res = await get<{
          Items?: Array<Record<string, unknown>>
          TotalRecordCount?: unknown
        }>(pathForPage(startIndex))
        return { total: res.TotalRecordCount, items: (res.Items ?? []).map(mapItem) }
      },
    )
  }

  /** Music libraries visible to the user (CollectionType 'music' views). */
  async function getMusicLibraries(): Promise<EmbyMusicLibrary[]> {
    const res = await get<{ Items?: Array<{ Id: string; Name: string; CollectionType?: string }> }>(
      `/Users/${userId}/Views`,
    )
    return toMusicLibraries(res.Items)
  }

  async function getTopArtists(limit = 50) {
    const path = artistListPath(
      userId,
      configuredLibraryId,
      { SortBy: 'PlayCount', SortOrder: 'Descending' },
      limit,
    )
    const res = await get<{ Items: Array<Record<string, unknown>> }>(path)
    return (res.Items ?? []).map((item) => mapArtist(item, false))
  }

  async function searchTracks(artistName: string, limit = 25): Promise<LibraryTrack[]> {
    const boundedLimit = trackSearchLimit(limit)
    if (!artistName.trim() || boundedLimit === 0) return []
    const res = await get<unknown>(
      trackSearchPath(userId, artistName, configuredLibraryId, boundedLimit),
    )
    return mapLibraryTracks(res, artistName, boundedLimit)
  }

  async function testConnection(): Promise<ServiceTestResult> {
    try {
      const info = await get<{ ServerName: string; Version: string }>('/System/Info')
      let libraries: EmbyMusicLibrary[] | null = null
      let selected: EmbyMusicLibrary | undefined
      if (userId) {
        libraries = await getMusicLibraries()
        if (configuredLibraryId) {
          selected = libraries.find((l) => l.id === configuredLibraryId)
          if (!selected) {
            return {
              success: false,
              message: `Configured Emby music library ${configuredLibraryId} not found - available: ${
                libraries.map((l) => `${l.name} (${l.id})`).join(', ') || 'none'
              }`,
            }
          }
        }
        const params = new URLSearchParams({
          IncludeItemTypes: 'Audio',
          Recursive: 'true',
          Limit: '1',
        })
        if (configuredLibraryId) params.set('ParentId', configuredLibraryId)
        await get<{ Items: Array<Record<string, unknown>> }>(
          `/Users/${userId}/Items?${params.toString()}`,
        )
      }
      return {
        success: true,
        message:
          `Connected to Emby "${info.ServerName}" v${info.Version}` +
          (selected ? ` - using library "${selected.name}"` : ''),
        details: {
          serverName: info.ServerName,
          version: info.Version,
          ...(libraries ? { libraries } : {}),
          ...(selected ? { libraryId: selected.id } : {}),
        },
      }
    } catch (err) {
      return { success: false, message: errMsg(err) }
    }
  }

  async function getFavoriteArtists(limit = 50) {
    // Match the Jellyfin client's query style. Both engines share the same
    // Items endpoint and accept the top-level IsFavorite=true form.
    const path = artistListPath(
      userId,
      configuredLibraryId,
      { SortBy: 'SortName', SortOrder: 'Ascending' },
      limit,
      true,
    )
    const res = await get<{ Items: Array<Record<string, unknown>> }>(path)
    return (res.Items ?? []).map((item) => mapArtist(item, true))
  }

  return {
    searchTracks,
    getTopArtists,
    getFavoriteArtists,
    getMusicLibraries,
    getRecentlyPlayed: async (limit = 50) => {
      const params = new URLSearchParams({
        SortBy: 'DatePlayed',
        SortOrder: 'Descending',
        IncludeItemTypes: 'Audio',
        Recursive: 'true',
        Limit: String(limit),
        Fields: 'UserData',
      })
      if (configuredLibraryId) params.set('ParentId', configuredLibraryId)
      const res = await get<{ Items: Array<Record<string, unknown>> }>(
        `/Users/${userId}/Items?${params.toString()}`,
      )
      return (res.Items ?? []).map(mapRecentTrack)
    },
    getAllArtists: () =>
      getLibraryItems<MediaBrowserLibraryArtist>(
        'artist',
        (startIndex) => {
          if (configuredLibraryId) {
            return scopedArtistsPath(userId, configuredLibraryId, {
              SortBy: 'SortName',
              SortOrder: 'Ascending',
              Fields: 'Genres,ProviderIds',
              StartIndex: String(startIndex),
              Limit: String(LIBRARY_PAGE_SIZE),
            })
          }
          const params = new URLSearchParams({
            IncludeItemTypes: 'MusicArtist',
            Recursive: 'true',
            Fields: 'Genres,ProviderIds',
            StartIndex: String(startIndex),
            Limit: String(LIBRARY_PAGE_SIZE),
          })
          return `/Users/${userId}/Items?${params.toString()}`
        },
        (item) => mapLibraryArtist(item, false),
      ),
    getAlbumsForArtist: (artistId: string) =>
      getLibraryItems<MediaBrowserLibraryAlbum>(
        'album',
        (startIndex) => {
          const params = new URLSearchParams({
            ParentId: artistId,
            IncludeItemTypes: 'MusicAlbum',
            Recursive: 'true',
            Fields: 'ProviderIds,ProductionYear',
            StartIndex: String(startIndex),
            Limit: String(LIBRARY_PAGE_SIZE),
          })
          return `/Users/${userId}/Items?${params.toString()}`
        },
        (item) => mapAlbum(item, artistId, false),
      ),
    testConnection,
  }
}
