import PQueue from 'p-queue'
import type { ServiceTestResult } from '@/core/types'
import { errMsg } from '@/core/validation'
import { createHttpClient } from './http'

export type JellyfinArtist = {
  name: string
  id: string
  playCount: number
  isFavorite: boolean
}

export type JellyfinLibraryArtist = {
  id: string
  name: string
  mbid?: string
  genres: string[]
}

export type JellyfinLibraryAlbum = {
  id: string
  artistId: string
  title: string
  mbid?: string
  releaseYear?: number
  primaryType?: 'Album'
}

export type JellyfinRecentTrack = {
  artistName: string
  trackName: string
  datePlayed: string
}

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
  options?: { baseUrl?: string; skipTlsVerify?: boolean },
) {
  const baseUrl = options?.baseUrl ?? url

  const http = createHttpClient({
    baseUrl,
    headers: {
      Authorization: `MediaBrowser Token="${apiKey}"`,
    },
    skipTlsVerify: options?.skipTlsVerify,
  })

  const queue = new PQueue({ concurrency: 3, interval: 1000, intervalCap: 10 })

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

  async function getTopArtists(limit = 50): Promise<JellyfinArtist[]> {
    const userId = await getUserId()
    const params = new URLSearchParams({
      SortBy: 'PlayCount',
      SortOrder: 'Descending',
      IncludeItemTypes: 'MusicArtist',
      Recursive: 'true',
      Fields: 'UserData',
      Limit: String(limit),
    })

    const res = await get<JellyfinItemsResponse>(`/Users/${userId}/Items?${params.toString()}`)

    return res.Items.filter((item) => {
      const userData = item.UserData as { PlayCount?: number } | undefined
      return (userData?.PlayCount ?? 0) > 0
    }).map((item) => {
      const userData = item.UserData as {
        PlayCount?: number
        IsFavorite?: boolean
      }
      return {
        name: item.Name as string,
        id: item.Id as string,
        playCount: userData?.PlayCount ?? 0,
        isFavorite: userData?.IsFavorite ?? false,
      }
    })
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

    const res = await get<JellyfinItemsResponse>(`/Users/${userId}/Items?${params.toString()}`)

    return res.Items.map((item) => {
      const artistName =
        (item.AlbumArtist as string) ||
        ((item.Artists as string[] | undefined)?.[0] ?? 'Unknown Artist')
      const userData = item.UserData as { LastPlayedDate?: string } | undefined
      return {
        artistName,
        trackName: item.Name as string,
        datePlayed: userData?.LastPlayedDate ?? new Date().toISOString(),
      }
    })
  }

  async function getFavoriteArtists(limit = 50): Promise<JellyfinArtist[]> {
    const userId = await getUserId()
    const params = new URLSearchParams({
      SortBy: 'SortName',
      SortOrder: 'Ascending',
      IncludeItemTypes: 'MusicArtist',
      Recursive: 'true',
      IsFavorite: 'true',
      Fields: 'UserData',
      Limit: String(limit),
    })

    const res = await get<JellyfinItemsResponse>(`/Users/${userId}/Items?${params.toString()}`)

    return res.Items.map((item) => {
      const userData = item.UserData as {
        PlayCount?: number
        IsFavorite?: boolean
      }
      return {
        name: item.Name as string,
        id: item.Id as string,
        playCount: userData?.PlayCount ?? 0,
        isFavorite: userData?.IsFavorite ?? true,
      }
    })
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
      const params = new URLSearchParams({
        IncludeItemTypes: 'MusicArtist',
        Recursive: 'true',
        Fields: 'Genres,ProviderIds',
        StartIndex: String(startIndex),
        Limit: String(pageSize),
      })
      const res = await get<{
        TotalRecordCount: number
        Items: Array<{
          Id: string
          Name: string
          Genres?: string[]
          ProviderIds?: { MusicBrainzArtist?: string }
        }>
      }>(`/Users/${userId}/Items?${params}`)

      total = res.TotalRecordCount ?? res.Items.length
      for (const item of res.Items) {
        all.push({
          id: item.Id,
          name: item.Name,
          mbid: item.ProviderIds?.MusicBrainzArtist?.trim() || undefined,
          genres: item.Genres ?? [],
        })
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
        Items: Array<{
          Id: string
          Name: string
          ProductionYear?: number
          ProviderIds?: { MusicBrainzReleaseGroup?: string; MusicBrainzAlbum?: string }
        }>
      }>(`/Users/${userId}/Items?${params}`)

      total = res.TotalRecordCount ?? res.Items.length
      for (const item of res.Items) {
        all.push({
          id: item.Id,
          artistId,
          title: item.Name,
          mbid: item.ProviderIds?.MusicBrainzReleaseGroup?.trim() || undefined,
          releaseYear: item.ProductionYear,
          primaryType: 'Album',
        })
      }
      if (res.Items.length === 0) break
      startIndex += res.Items.length
    }

    return all
  }

  async function testConnection(): Promise<ServiceTestResult> {
    try {
      const info = await get<JellyfinSystemInfo>('/System/Info')
      if (userIdOrName) {
        const userId = await getUserId()
        const params = new URLSearchParams({
          IncludeItemTypes: 'Audio',
          Recursive: 'true',
          Limit: '1',
        })
        await get<JellyfinItemsResponse>(`/Users/${userId}/Items?${params.toString()}`)
      }
      const artists = await getTopArtists(5)
      return {
        success: true,
        message: `Connected to Jellyfin "${info.ServerName}" v${info.Version} -- ${artists.length} top artist(s)`,
        details: {
          serverName: info.ServerName,
          version: info.Version,
          artistCount: artists.length,
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
    testConnection,
  }
}
