import PQueue from 'p-queue'
import type { ServiceTestResult } from '@/core/types'
import { errMsg } from '@/core/validation'
import { createHttpClient } from './http'

export function createEmbyClient(
  url: string,
  apiKey: string,
  userId: string,
  options?: { baseUrl?: string; skipTlsVerify?: boolean },
) {
  const http = createHttpClient({
    baseUrl: options?.baseUrl ?? url,
    headers: {
      'X-Emby-Token': apiKey,
    },
    skipTlsVerify: options?.skipTlsVerify,
  })

  const queue = new PQueue({ concurrency: 3, interval: 1000, intervalCap: 10 })

  function get<T>(path: string): Promise<T> {
    return queue.add(() => http.get<T>(path)) as Promise<T>
  }

  async function getTopArtists(limit = 50) {
    const params = new URLSearchParams({
      SortBy: 'PlayCount',
      SortOrder: 'Descending',
      IncludeItemTypes: 'MusicArtist',
      Recursive: 'true',
      Fields: 'UserData',
      Limit: String(limit),
    })
    const res = await get<{ Items: Array<Record<string, unknown>> }>(
      `/Users/${userId}/Items?${params.toString()}`,
    )
    return (res.Items ?? []).map((item) => ({
      id: item.Id as string,
      name: item.Name as string,
      playCount: (item.UserData as { PlayCount?: number } | undefined)?.PlayCount ?? 0,
      isFavorite: (item.UserData as { IsFavorite?: boolean } | undefined)?.IsFavorite ?? false,
    }))
  }

  async function testConnection(): Promise<ServiceTestResult> {
    try {
      const info = await get<{ ServerName: string; Version: string }>('/System/Info')
      return {
        success: true,
        message: `Connected to Emby "${info.ServerName}" v${info.Version}`,
      }
    } catch (err) {
      return { success: false, message: errMsg(err) }
    }
  }

  async function getFavoriteArtists(limit = 50) {
    // Match the Jellyfin client's query style. Both engines share the same
    // Items endpoint and accept the top-level IsFavorite=true form.
    const params = new URLSearchParams({
      SortBy: 'SortName',
      SortOrder: 'Ascending',
      IncludeItemTypes: 'MusicArtist',
      Recursive: 'true',
      IsFavorite: 'true',
      Fields: 'UserData',
      Limit: String(limit),
    })
    const res = await get<{ Items: Array<Record<string, unknown>> }>(
      `/Users/${userId}/Items?${params.toString()}`,
    )
    return (res.Items ?? []).map((item) => ({
      id: item.Id as string,
      name: item.Name as string,
      playCount: (item.UserData as { PlayCount?: number } | undefined)?.PlayCount ?? 0,
      isFavorite: true,
    }))
  }

  return {
    getTopArtists,
    getFavoriteArtists,
    getRecentlyPlayed: async (limit = 50) => {
      const params = new URLSearchParams({
        SortBy: 'DatePlayed',
        SortOrder: 'Descending',
        IncludeItemTypes: 'Audio',
        Recursive: 'true',
        Limit: String(limit),
        Fields: 'UserData',
      })
      const res = await get<{ Items: Array<Record<string, unknown>> }>(
        `/Users/${userId}/Items?${params.toString()}`,
      )
      return (res.Items ?? []).map((item) => ({
        artistName:
          (item.AlbumArtist as string) ||
          ((item.Artists as string[] | undefined)?.[0] ?? 'Unknown Artist'),
        trackName: item.Name as string,
        datePlayed:
          (item.UserData as { LastPlayedDate?: string } | undefined)?.LastPlayedDate ??
          new Date().toISOString(),
      }))
    },
    getAllArtists: async () => {
      const params = new URLSearchParams({
        IncludeItemTypes: 'MusicArtist',
        Recursive: 'true',
        Fields: 'Genres,ProviderIds',
        Limit: '200',
      })
      const res = await get<{ Items: Array<Record<string, unknown>> }>(
        `/Users/${userId}/Items?${params.toString()}`,
      )
      return (res.Items ?? []).map((item) => ({
        id: item.Id as string,
        name: item.Name as string,
        mbid: (item.ProviderIds as { MusicBrainzArtist?: string } | undefined)?.MusicBrainzArtist,
        genres: (item.Genres as string[] | undefined) ?? [],
      }))
    },
    getAlbumsForArtist: async (artistId: string) => {
      const params = new URLSearchParams({
        ParentId: artistId,
        IncludeItemTypes: 'MusicAlbum',
        Recursive: 'true',
        Fields: 'ProviderIds,ProductionYear',
        Limit: '200',
      })
      const res = await get<{ Items: Array<Record<string, unknown>> }>(
        `/Users/${userId}/Items?${params.toString()}`,
      )
      return (res.Items ?? []).map((item) => ({
        id: item.Id as string,
        artistId,
        title: item.Name as string,
        mbid: (item.ProviderIds as { MusicBrainzReleaseGroup?: string } | undefined)
          ?.MusicBrainzReleaseGroup,
        releaseYear: item.ProductionYear as number | undefined,
        primaryType: 'Album' as const,
      }))
    },
    testConnection,
  }
}
