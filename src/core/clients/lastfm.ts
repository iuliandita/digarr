import PQueue from 'p-queue'
import type { DiscoveredArtist, ServiceTestResult } from '@/core/types'
import { errMsg } from '@/core/validation'
import { createHttpClient } from './http'

const BASE_URL = 'https://ws.audioscrobbler.com/2.0/'

export type LastFmPeriod = '7day' | '1month' | '3month' | '6month' | '12month' | 'overall'

export type LastFmTopArtist = {
  name: string
  mbid?: string
  playCount: number
  source: 'lastfm'
}

export type LastFmRecentTrack = {
  artist: { '#text': string; mbid?: string }
  name: string
  album?: { '#text': string }
  image?: Array<{ '#text': string; size: string }>
  date?: { uts: string; '#text': string }
  '@attr'?: { nowplaying?: string }
  mbid?: string
}

export type LastFmPagedTopArtists = {
  artists: LastFmTopArtist[]
  totalCount: number
}

// Raw Last.fm response shapes
type LfmSimilarArtistsResponse = {
  similarartists: {
    artist: Array<{ name: string; match: string; mbid: string }>
  }
}

type LfmTopArtistsResponse = {
  topartists: {
    artist: Array<{ name: string; mbid: string; playcount: string }>
    '@attr'?: { total?: string; totalPages?: string; page?: string; perPage?: string }
  }
}

type LfmRecentTracksResponse = {
  recenttracks: {
    track: LastFmRecentTrack[]
  }
}

type LfmTagTopArtistsResponse = {
  topartists: {
    artist: Array<{ name: string; mbid?: string; listeners?: string }>
  }
}

export function createLastFmClient(username: string, apiKey: string) {
  const http = createHttpClient({ baseUrl: BASE_URL })

  const queue = new PQueue({ concurrency: 5, interval: 1000, intervalCap: 5 })

  function buildUrl(params: Record<string, string>): string {
    const searchParams = new URLSearchParams({ ...params, api_key: apiKey, format: 'json' })
    return `?${searchParams.toString()}`
  }

  function get<T>(params: Record<string, string>): Promise<T> {
    return queue.add(() => http.get<T>(buildUrl(params))) as Promise<T>
  }

  async function getSimilarArtists(artist: string, mbid?: string): Promise<DiscoveredArtist[]> {
    const params: Record<string, string> = { method: 'artist.getSimilar', artist }
    if (mbid) params.mbid = mbid
    const res = await get<LfmSimilarArtistsResponse>(params)
    return res.similarartists.artist.map((a) => ({
      name: a.name,
      mbid: a.mbid || undefined,
      similarityScore: parseFloat(a.match),
      source: 'lastfm' as const,
    }))
  }

  async function getTopArtists(period: LastFmPeriod): Promise<LastFmTopArtist[]> {
    const res = await get<LfmTopArtistsResponse>({
      method: 'user.getTopArtists',
      user: username,
      period,
    })
    return res.topartists.artist.map((a) => ({
      name: a.name,
      mbid: a.mbid || undefined,
      playCount: parseInt(a.playcount, 10),
      source: 'lastfm' as const,
    }))
  }

  async function getTopArtistsPaged(
    period: LastFmPeriod,
    options: { page?: number; limit?: number } = {},
  ): Promise<LastFmPagedTopArtists> {
    const params: Record<string, string> = {
      method: 'user.getTopArtists',
      user: username,
      period,
    }
    if (options.page != null) params.page = String(options.page)
    if (options.limit != null) params.limit = String(options.limit)
    const res = await get<LfmTopArtistsResponse>(params)
    const totalCount = parseInt(res.topartists['@attr']?.total ?? '0', 10)
    return {
      artists: res.topartists.artist.map((a) => ({
        name: a.name,
        mbid: a.mbid || undefined,
        playCount: parseInt(a.playcount, 10),
        source: 'lastfm' as const,
      })),
      totalCount: Number.isFinite(totalCount) ? totalCount : res.topartists.artist.length,
    }
  }

  async function getRecentTracks(limit = 50): Promise<LastFmRecentTrack[]> {
    const res = await get<LfmRecentTracksResponse>({
      method: 'user.getRecentTracks',
      user: username,
      limit: String(limit),
    })
    return res.recenttracks.track
  }

  async function getTopArtistsByTag(
    tag: string,
    limit = 20,
  ): Promise<Array<{ name: string; mbid?: string; listeners: number }>> {
    const res = await get<LfmTagTopArtistsResponse>({
      method: 'tag.gettopartists',
      tag,
      limit: String(limit),
    })
    const artists = res?.topartists?.artist ?? []
    return artists.map((a) => ({
      name: a.name,
      mbid: a.mbid || undefined,
      listeners: Number(a.listeners) || 0,
    }))
  }

  async function testConnection(): Promise<ServiceTestResult> {
    try {
      const artists = await getTopArtists('7day')
      return {
        success: true,
        message: `Connected to Last.fm - ${artists.length} top artists for ${username}`,
        details: { artistCount: artists.length },
      }
    } catch (err: unknown) {
      return { success: false, message: errMsg(err) }
    }
  }

  return {
    getSimilarArtists,
    getTopArtists,
    getTopArtistsPaged,
    getTopArtistsByTag,
    getRecentTracks,
    testConnection,
  }
}
