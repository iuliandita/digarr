import { randomBytes } from 'node:crypto'
import PQueue from 'p-queue'
import type { ServiceTestResult } from '@/core/types'
import { errMsg } from '@/core/validation'
import { createHttpClient } from './http'
import {
  buildSubsonicAuthParams,
  type SubsonicEnvelope,
  unwrapSubsonicResponse,
} from './subsonic-auth'

export type SubsonicArtist = {
  id: string
  name: string
}

export type SubsonicAlbum = {
  id: string
  artistId: string
  title: string
  releaseYear?: number
}

type RawArtist = {
  id?: string | number
  name?: string
}

type RawAlbum = {
  id?: string | number
  name?: string
  artistId?: string | number
  year?: number
}

type StarredBody = {
  starred2?: { artist?: RawArtist[] }
}

type ArtistsBody = {
  artists?: { index?: Array<{ artist?: RawArtist[] }> }
}

type ArtistBody = {
  artist?: { id?: string | number; name?: string; album?: RawAlbum[] }
}

export function createSubsonicClient(
  url: string,
  username: string,
  password: string,
  options?: { baseUrl?: string; skipTlsVerify?: boolean; salt?: string },
) {
  const baseUrl = options?.baseUrl ?? url

  const http = createHttpClient({
    baseUrl,
    skipTlsVerify: options?.skipTlsVerify,
  })

  const queue = new PQueue({ concurrency: 3, interval: 1000, intervalCap: 10 })

  function get<T>(path: string): Promise<T> {
    return queue.add(() => http.get<T>(path)) as Promise<T>
  }

  const salt = options?.salt ?? randomBytes(8).toString('hex')

  function restPath(method: string, extra?: Record<string, string>): string {
    const params = buildSubsonicAuthParams({
      username,
      password,
      salt,
      extra,
    })
    return `/rest/${method}?${params.toString()}`
  }

  function mapArtist(a: RawArtist): SubsonicArtist {
    return { id: String(a.id), name: a.name ?? '' }
  }

  async function getStarredArtists(): Promise<SubsonicArtist[]> {
    const body = unwrapSubsonicResponse(
      await get<SubsonicEnvelope<StarredBody>>(restPath('getStarred2')),
      'Subsonic request failed',
    )
    return (body.starred2?.artist ?? []).filter((a) => a.id != null).map(mapArtist)
  }

  async function getAllArtists(): Promise<SubsonicArtist[]> {
    const body = unwrapSubsonicResponse(
      await get<SubsonicEnvelope<ArtistsBody>>(restPath('getArtists')),
      'Subsonic request failed',
    )
    return (body.artists?.index?.flatMap((i) => i.artist ?? []) ?? [])
      .filter((a) => a.id != null)
      .map(mapArtist)
  }

  async function getAlbumsForArtist(artistId: string): Promise<SubsonicAlbum[]> {
    const body = unwrapSubsonicResponse(
      await get<SubsonicEnvelope<ArtistBody>>(restPath('getArtist', { id: artistId })),
      'Subsonic request failed',
    )
    return (body.artist?.album ?? [])
      .filter((al) => al.id != null)
      .map((al) => ({
        id: String(al.id),
        artistId: String(al.artistId ?? artistId),
        title: al.name ?? '',
        releaseYear: al.year,
      }))
  }

  async function testConnection(): Promise<ServiceTestResult> {
    try {
      const body = unwrapSubsonicResponse(
        await get<SubsonicEnvelope<Record<string, never>>>(restPath('ping')),
        'Subsonic ping failed',
      )
      return {
        success: true,
        message: `Connected to Subsonic${body.type ? ` (${body.type})` : ''}`,
        details: { version: body.version, type: body.type },
      }
    } catch (e: unknown) {
      return { success: false, message: errMsg(e) }
    }
  }

  return {
    getStarredArtists,
    getAllArtists,
    getAlbumsForArtist,
    testConnection,
  }
}
