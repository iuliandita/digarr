import type { ServiceTestResult } from '@/core/types'
import { errMsg } from '@/core/validation'
import { createHttpClient } from './http'
import {
  type MediaBrowserArtist,
  type MediaBrowserLibrary,
  type MediaBrowserLibraryAlbum,
  type MediaBrowserLibraryArtist,
  type MediaBrowserRecentTrack,
  mapAlbum,
  mapArtist,
  mapLibraryArtist,
  mapRecentTrack,
  scopedArtistsPath,
  toMusicLibraries,
} from './media-browser'
import { createMediaServerQueue } from './media-server-queue'

export type JellyfinArtist = MediaBrowserArtist
export type JellyfinLibraryArtist = MediaBrowserLibraryArtist
export type JellyfinLibraryAlbum = MediaBrowserLibraryAlbum
export type JellyfinRecentTrack = MediaBrowserRecentTrack
export type JellyfinMusicLibrary = MediaBrowserLibrary

type JellyfinItemsResponse = {
  Items: Array<Record<string, unknown>>
  TotalRecordCount: number
}

type JellyfinSystemInfo = {
  ServerName: string
  Version: string
}

type JellyfinUser = {
  Id: string
  Name: string
}

const UUID_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i

export function createJellyfinClient(
  url: string,
  apiKey: string,
  userIdOrName: string,
  options?: { baseUrl?: string; skipTlsVerify?: boolean; libraryId?: string | null },
) {
  const baseUrl = options?.baseUrl ?? url
  const configuredLibraryId = options?.libraryId?.trim() || null

  const http = createHttpClient({
    baseUrl,
    headers: {
      Authorization: `MediaBrowser Token="${apiKey}"`,
    },
    skipTlsVerify: options?.skipTlsVerify,
  })

  const queue = createMediaServerQueue()

  function get<T>(path: string): Promise<T> {
    return queue.add(() => http.get<T>(path)) as Promise<T>
  }

  let resolvedUserId: string | null = null

  async function getUserId(): Promise<string> {
    if (resolvedUserId) return resolvedUserId

    if (UUID_RE.test(userIdOrName)) {
      resolvedUserId = userIdOrName
      return resolvedUserId
    }

    const users = await get<JellyfinUser[]>('/Users')
    const match = users.find((u) => u.Name.toLowerCase() === userIdOrName.toLowerCase())
    if (!match) {
      throw new Error(
        `Jellyfin user "${userIdOrName}" not found. Check the username or use the user ID (UUID) instead.`,
      )
    }
    resolvedUserId = match.Id
    return resolvedUserId
  }

  /** Music libraries visible to the user (CollectionType 'music' views). */
  async function getMusicLibraries(): Promise<JellyfinMusicLibrary[]> {
    const userId = await getUserId()
    const res = await get<{ Items?: Array<{ Id: string; Name: string; CollectionType?: string }> }>(
      `/Users/${userId}/Views`,
    )
    return toMusicLibraries(res.Items)
  }

  async function getTopArtists(limit = 50): Promise<JellyfinArtist[]> {
    const userId = await getUserId()
    let res: JellyfinItemsResponse
    if (configuredLibraryId) {
      res = await get<JellyfinItemsResponse>(
        scopedArtistsPath(userId, configuredLibraryId, {
          SortBy: 'PlayCount',
          SortOrder: 'Descending',
          Fields: 'UserData,Genres,ProviderIds',
          Limit: String(limit),
        }),
      )
    } else {
      const params = new URLSearchParams({
        SortBy: 'PlayCount',
        SortOrder: 'Descending',
        IncludeItemTypes: 'MusicArtist',
        Recursive: 'true',
        Fields: 'UserData,Genres,ProviderIds',
        Limit: String(limit),
      })
      res = await get<JellyfinItemsResponse>(`/Users/${userId}/Items?${params.toString()}`)
    }

    return res.Items.filter((item) => {
      const userData = item.UserData as { PlayCount?: number } | undefined
      return (userData?.PlayCount ?? 0) > 0
    }).map((item) => mapArtist(item, false))
  }

  async function getRecentlyPlayed(limit = 50): Promise<JellyfinRecentTrack[]> {
    const userId = await getUserId()
    const params = new URLSearchParams({
      SortBy: 'DatePlayed',
      SortOrder: 'Descending',
      IncludeItemTypes: 'Audio',
      Recursive: 'true',
      IsPlayed: 'true',
      Fields: 'UserData',
      Limit: String(limit),
    })
    if (configuredLibraryId) params.set('ParentId', configuredLibraryId)

    const res = await get<JellyfinItemsResponse>(`/Users/${userId}/Items?${params.toString()}`)

    return res.Items.map(mapRecentTrack)
  }

  async function getFavoriteArtists(limit = 50): Promise<JellyfinArtist[]> {
    const userId = await getUserId()
    let res: JellyfinItemsResponse
    if (configuredLibraryId) {
      res = await get<JellyfinItemsResponse>(
        scopedArtistsPath(userId, configuredLibraryId, {
          SortBy: 'SortName',
          SortOrder: 'Ascending',
          IsFavorite: 'true',
          Fields: 'UserData,Genres,ProviderIds',
          Limit: String(limit),
        }),
      )
    } else {
      const params = new URLSearchParams({
        SortBy: 'SortName',
        SortOrder: 'Ascending',
        IncludeItemTypes: 'MusicArtist',
        Recursive: 'true',
        IsFavorite: 'true',
        Fields: 'UserData,Genres,ProviderIds',
        Limit: String(limit),
      })
      res = await get<JellyfinItemsResponse>(`/Users/${userId}/Items?${params.toString()}`)
    }

    return res.Items.map((item) => mapArtist(item, true))
  }

  /**
   * Return every artist in the user's music library, paginated. When the
   * MB metadata agent is enabled (the common case), each artist will have
   * its MBID under ProviderIds.MusicBrainzArtist.
   */
  async function getAllArtists(options?: { pageSize?: number }): Promise<JellyfinLibraryArtist[]> {
    const userId = await getUserId()
    const pageSize = options?.pageSize ?? 200

    const all: JellyfinLibraryArtist[] = []
    let startIndex = 0
    let total = Number.POSITIVE_INFINITY

    while (startIndex < total) {
      let path: string
      if (configuredLibraryId) {
        // SortName paging: /Artists needs an explicit sort for stable pages.
        path = scopedArtistsPath(userId, configuredLibraryId, {
          SortBy: 'SortName',
          SortOrder: 'Ascending',
          Fields: 'Genres,ProviderIds',
          StartIndex: String(startIndex),
          Limit: String(pageSize),
        })
      } else {
        const params = new URLSearchParams({
          IncludeItemTypes: 'MusicArtist',
          Recursive: 'true',
          Fields: 'Genres,ProviderIds',
          StartIndex: String(startIndex),
          Limit: String(pageSize),
        })
        path = `/Users/${userId}/Items?${params}`
      }
      const res = await get<{
        TotalRecordCount: number
        Items: Array<Record<string, unknown>>
      }>(path)

      total = res.TotalRecordCount ?? res.Items.length
      for (const item of res.Items) {
        all.push(mapLibraryArtist(item, true))
      }
      if (res.Items.length === 0) break
      startIndex += res.Items.length
    }

    return all
  }

  async function getAlbumsForArtist(artistId: string): Promise<JellyfinLibraryAlbum[]> {
    const userId = await getUserId()
    const pageSize = 200
    const all: JellyfinLibraryAlbum[] = []
    let startIndex = 0
    let total = Number.POSITIVE_INFINITY

    while (startIndex < total) {
      const params = new URLSearchParams({
        ParentId: artistId,
        IncludeItemTypes: 'MusicAlbum',
        Recursive: 'true',
        Fields: 'ProviderIds,ProductionYear',
        StartIndex: String(startIndex),
        Limit: String(pageSize),
      })

      const res = await get<{
        TotalRecordCount: number
        Items: Array<Record<string, unknown>>
      }>(`/Users/${userId}/Items?${params}`)

      total = res.TotalRecordCount ?? res.Items.length
      for (const item of res.Items) {
        all.push(mapAlbum(item, artistId, true))
      }
      if (res.Items.length === 0) break
      startIndex += res.Items.length
    }

    return all
  }

  async function testConnection(): Promise<ServiceTestResult> {
    try {
      const info = await get<JellyfinSystemInfo>('/System/Info')
      let libraries: JellyfinMusicLibrary[] | null = null
      let selected: JellyfinMusicLibrary | undefined
      if (userIdOrName) {
        const userId = await getUserId()
        libraries = await getMusicLibraries()
        if (configuredLibraryId) {
          selected = libraries.find((l) => l.id === configuredLibraryId)
          if (!selected) {
            return {
              success: false,
              message: `Configured Jellyfin music library ${configuredLibraryId} not found - available: ${
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
        await get<JellyfinItemsResponse>(`/Users/${userId}/Items?${params.toString()}`)
      }
      const artists = await getTopArtists(5)
      return {
        success: true,
        message:
          `Connected to Jellyfin "${info.ServerName}" v${info.Version} - ${artists.length} top artist(s)` +
          (selected ? ` - using library "${selected.name}"` : ''),
        details: {
          serverName: info.ServerName,
          version: info.Version,
          artistCount: artists.length,
          ...(libraries ? { libraries } : {}),
          ...(selected ? { libraryId: selected.id } : {}),
        },
      }
    } catch (err: unknown) {
      return { success: false, message: errMsg(err) }
    }
  }

  return {
    getTopArtists,
    getAllArtists,
    getAlbumsForArtist,
    getRecentlyPlayed,
    getFavoriteArtists,
    getMusicLibraries,
    testConnection,
  }
}
