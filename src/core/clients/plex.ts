import PQueue from 'p-queue'
import type { ServiceTestResult } from '@/core/types'
import { errMsg } from '@/core/validation'
import { createHttpClient } from './http'

export type PlexTopArtist = {
  name: string
  viewCount: number
  ratingKey: string
}

export type PlexRecentTrack = {
  artistName: string
  trackName: string
  viewedAt: number
}

// Raw Plex API response shapes
type PlexSectionsResponse = {
  MediaContainer: {
    Directory: Array<{ key: string; type: string; title: string }>
  }
}

type PlexArtistsResponse = {
  MediaContainer: {
    Metadata: Array<{ title: string; viewCount?: number; ratingKey: string }>
  }
}

type PlexHistoryResponse = {
  MediaContainer: {
    Metadata?: Array<{
      type: string
      grandparentTitle: string
      title: string
      viewedAt: number
    }>
  }
}

type PlexAllArtistsResponse = {
  MediaContainer: {
    totalSize?: number
    Metadata?: Array<{
      ratingKey: string
      title: string
      Genre?: Array<{ tag: string }>
    }>
  }
}

export type PlexLibraryArtist = {
  ratingKey: string
  name: string
  genres: string[]
}

export type PlexLibraryAlbum = {
  ratingKey: string
  artistRatingKey: string
  title: string
  releaseYear?: number
  primaryType?: 'Album'
}

export type PlexClient = {
  getMusicSectionId: () => Promise<string>
  getTopArtists: (limit?: number) => Promise<PlexTopArtist[]>
  getAllArtists: (options?: { pageSize?: number }) => Promise<PlexLibraryArtist[]>
  getAlbumsForArtist: (artistRatingKey: string) => Promise<PlexLibraryAlbum[]>
  getRecentlyPlayed: (limit?: number) => Promise<PlexRecentTrack[]>
  testConnection: () => Promise<ServiceTestResult>
}

export function createPlexClient(
  url: string,
  token: string,
  options?: { baseUrl?: string },
): PlexClient {
  const baseUrl = options?.baseUrl ?? url.replace(/\/+$/, '')

  const http = createHttpClient({
    baseUrl,
    headers: {
      'X-Plex-Token': token,
      Accept: 'application/json',
    },
    publicIpOnly: true,
  })

  const queue = new PQueue({ concurrency: 3, interval: 1000, intervalCap: 10 })

  function get<T>(path: string): Promise<T> {
    return queue.add(() => http.get<T>(path)) as Promise<T>
  }

  async function getMusicSectionId(): Promise<string> {
    const res = await get<PlexSectionsResponse>('/library/sections')
    const section = res.MediaContainer.Directory.find((d) => d.type === 'artist')
    if (!section) {
      throw new Error('No music library section found in Plex')
    }
    return section.key
  }

  async function getTopArtists(limit = 50): Promise<PlexTopArtist[]> {
    const sectionId = await getMusicSectionId()
    const res = await get<PlexArtistsResponse>(
      `/library/sections/${sectionId}/all?type=8&sort=viewCount:desc&X-Plex-Container-Start=0&X-Plex-Container-Size=${limit}`,
    )
    const metadata = res.MediaContainer.Metadata ?? []
    return metadata.map((m) => ({
      name: m.title,
      viewCount: m.viewCount ?? 0,
      ratingKey: m.ratingKey,
    }))
  }

  async function getRecentlyPlayed(limit = 50): Promise<PlexRecentTrack[]> {
    const res = await get<PlexHistoryResponse>(
      `/status/sessions/history/all?sort=viewedAt:desc&X-Plex-Container-Start=0&X-Plex-Container-Size=${limit}`,
    )
    const metadata = res.MediaContainer.Metadata ?? []
    return metadata
      .filter((m) => m.type === 'track')
      .map((m) => ({
        artistName: m.grandparentTitle,
        trackName: m.title,
        viewedAt: m.viewedAt * 1000,
      }))
  }

  /**
   * Return every artist in the music library, paginated. Default page size 200
   * so a 5000-artist library is 25 requests at PQueue concurrency 3.
   *
   * Genres come from Plex's Genre tags. The default Plex Music agent does
   * not provide MBIDs, so the reconciler must look them up.
   */
  async function getAllArtists(options?: { pageSize?: number }): Promise<PlexLibraryArtist[]> {
    const sectionId = await getMusicSectionId()
    const pageSize = options?.pageSize ?? 200

    const all: PlexLibraryArtist[] = []
    let start = 0
    let total = Number.POSITIVE_INFINITY

    while (start < total) {
      const params = new URLSearchParams({
        type: '8',
        sort: 'titleSort',
        'X-Plex-Container-Start': String(start),
        'X-Plex-Container-Size': String(pageSize),
      })
      const res = await get<PlexAllArtistsResponse>(`/library/sections/${sectionId}/all?${params}`)
      const metadata = res.MediaContainer.Metadata ?? []
      total = res.MediaContainer.totalSize ?? metadata.length
      for (const m of metadata) {
        all.push({
          ratingKey: m.ratingKey,
          name: m.title,
          genres: (m.Genre ?? []).map((g) => g.tag),
        })
      }
      if (metadata.length === 0) break
      start += metadata.length
    }

    return all
  }

  async function getAlbumsForArtist(artistRatingKey: string): Promise<PlexLibraryAlbum[]> {
    const pageSize = 200
    const all: PlexLibraryAlbum[] = []
    let start = 0
    let total: number | undefined

    while (start < (total ?? Number.POSITIVE_INFINITY)) {
      const params = new URLSearchParams({
        type: '9',
        'X-Plex-Container-Start': String(start),
        'X-Plex-Container-Size': String(pageSize),
      })
      const res = await get<{
        MediaContainer: {
          totalSize?: number
          Metadata?: Array<{
            ratingKey: string
            parentRatingKey: string
            title: string
            year?: number
          }>
        }
      }>(`/library/metadata/${artistRatingKey}/children?${params}`)

      const metadata = res.MediaContainer.Metadata ?? []
      if (res.MediaContainer.totalSize != null) {
        total = res.MediaContainer.totalSize
      }
      for (const item of metadata) {
        all.push({
          ratingKey: item.ratingKey,
          artistRatingKey: item.parentRatingKey,
          title: item.title,
          releaseYear: item.year,
          primaryType: 'Album',
        })
      }
      if (metadata.length === 0) break
      start += metadata.length
      if (total == null && metadata.length < pageSize) break
    }

    return all
  }

  async function testConnection(): Promise<ServiceTestResult> {
    try {
      const sectionId = await getMusicSectionId()
      return {
        success: true,
        message: `Connected to Plex -- music library section ${sectionId}`,
        details: { sectionId },
      }
    } catch (err: unknown) {
      return { success: false, message: errMsg(err) }
    }
  }

  return {
    getMusicSectionId,
    getTopArtists,
    getAllArtists,
    getAlbumsForArtist,
    getRecentlyPlayed,
    testConnection,
  }
}
