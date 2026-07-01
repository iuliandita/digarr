import { createHash, randomBytes } from 'node:crypto'
import PQueue from 'p-queue'
import type { ServiceTestResult } from '@/core/types'
import { errMsg } from '@/core/validation'
import { createHttpClient } from './http'

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

type SubsonicEnvelope<T> = {
  'subsonic-response': {
    status: 'ok' | 'failed'
    version?: string
    type?: string
    error?: { code: number; message: string }
  } & T
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

  // Subsonic token auth (protocol >= 1.13.0): the plaintext password is never
  // sent. salt is generated once per client instance.
  const salt = options?.salt ?? randomBytes(8).toString('hex')
  const token = createHash('md5')
    .update(password + salt)
    .digest('hex')

  function restPath(method: string, extra?: Record<string, string>): string {
    const params = new URLSearchParams({
      u: username,
      t: token,
      s: salt,
      v: '1.16.1',
      c: 'digarr',
      f: 'json',
      ...extra,
    })
    return `/rest/${method}?${params.toString()}`
  }

  function unwrap<T>(resp: SubsonicEnvelope<T>): SubsonicEnvelope<T>['subsonic-response'] {
    const body = resp?.['subsonic-response']
    if (!body || typeof body.status !== 'string') {
      throw new Error('Malformed Subsonic response (missing subsonic-response envelope)')
    }
    if (body.status === 'failed') {
      throw new Error(body.error?.message ?? 'Subsonic request failed')
    }
    return body
  }

  function mapArtist(a: RawArtist): SubsonicArtist {
    return { id: String(a.id), name: a.name ?? '' }
  }

  async function getStarredArtists(): Promise<SubsonicArtist[]> {
    const body = unwrap(await get<SubsonicEnvelope<StarredBody>>(restPath('getStarred2')))
    return (body.starred2?.artist ?? []).filter((a) => a.id != null).map(mapArtist)
  }

  async function getAllArtists(): Promise<SubsonicArtist[]> {
    const body = unwrap(await get<SubsonicEnvelope<ArtistsBody>>(restPath('getArtists')))
    return (body.artists?.index?.flatMap((i) => i.artist ?? []) ?? [])
      .filter((a) => a.id != null)
      .map(mapArtist)
  }

  async function getAlbumsForArtist(artistId: string): Promise<SubsonicAlbum[]> {
    const body = unwrap(
      await get<SubsonicEnvelope<ArtistBody>>(restPath('getArtist', { id: artistId })),
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
      const resp = await get<SubsonicEnvelope<Record<string, never>>>(restPath('ping'))
      const body = resp['subsonic-response']
      if (body.status === 'ok') {
        return {
          success: true,
          message: `Connected to Subsonic${body.type ? ` (${body.type})` : ''}`,
          details: { version: body.version, type: body.type },
        }
      }
      return { success: false, message: body.error?.message ?? 'Subsonic ping failed' }
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
