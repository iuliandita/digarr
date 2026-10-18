import { createHttpClient, HttpError } from '@/core/clients/http'
import type { ServiceTestResult } from '@/core/types'
import { isCloudMetadata } from '@/core/validation'

export type AudioMuseConfig = {
  url: string
  token?: string
  skipTlsVerify?: boolean
  skipReason?: 'token_unreadable'
}
export type AudioMuseSkipReason =
  | 'unreachable'
  | 'not_indexed'
  | 'artist_unknown'
  | 'authentication_required'
  | 'invalid_response'
  | 'request_failed'

export class AudioMuseError extends Error {
  constructor(public reason: AudioMuseSkipReason) {
    super(`AudioMuse-AI: ${reason}`)
  }
}

// Verified against v3.6.4: app_artist_similarity.py and tasks/artist_gmm_manager.py.
export function normalizeAudioMuseArtists(body: unknown) {
  if (!Array.isArray(body)) throw new AudioMuseError('invalid_response')
  return body.flatMap((row: unknown) => {
    if (
      row === null ||
      typeof row !== 'object' ||
      !('artist' in row) ||
      typeof row.artist !== 'string' ||
      !row.artist.trim() ||
      !('divergence' in row) ||
      typeof row.divergence !== 'number' ||
      !Number.isFinite(row.divergence) ||
      row.divergence < 0
    ) {
      return []
    }
    return [
      {
        name: row.artist.trim(),
        similarityScore: 1 / (1 + row.divergence),
        source: 'audiomuse',
      },
    ]
  })
}

function mapError(error: unknown): AudioMuseError {
  if (error instanceof AudioMuseError) return error
  if (!(error instanceof HttpError)) return new AudioMuseError('unreachable')
  let code: unknown
  try {
    code = JSON.parse(error.body).error_code
  } catch {
    // A proxy or an older API may return HTML instead of the error envelope.
  }
  if (code === 3002) return new AudioMuseError('not_indexed')
  if (code === 1004 && error.status === 404) return new AudioMuseError('artist_unknown')
  if (error.status === 401 || error.status === 403)
    return new AudioMuseError('authentication_required')
  if (error.status === 200) return new AudioMuseError('invalid_response')
  if (error.status >= 500) return new AudioMuseError('unreachable')
  return new AudioMuseError('request_failed')
}

export function createAudioMuseClient(config: AudioMuseConfig) {
  const url = new URL(config.url)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    isCloudMetadata(url.toString()) ||
    url.hostname === '[fd00:ec2::254]'
  )
    throw new Error('AudioMuse-AI URL must use HTTP(S) without credentials, query, or fragment')
  const http = createHttpClient({
    baseUrl: config.url,
    headers: config.token ? { Authorization: `Bearer ${config.token}` } : {},
    skipTlsVerify: config.skipTlsVerify,
    timeout: 10_000,
    retries: 0,
  })
  return {
    async getSimilarArtists(artistName: string) {
      const params = new URLSearchParams({ artist: artistName, n: '20' })
      try {
        const artists = normalizeAudioMuseArtists(
          await http.get<unknown>(`/api/similar_artists?${params}`),
        )
        if (!artists.length) throw new AudioMuseError('artist_unknown')
        return artists
      } catch (error) {
        throw mapError(error)
      }
    },
    async testConnection(): Promise<ServiceTestResult> {
      try {
        const body = await http.get<{ app_version?: unknown }>('/api/version')
        if (typeof body?.app_version !== 'string' || !body.app_version.trim())
          throw new AudioMuseError('invalid_response')
        return { success: true, message: 'AudioMuse-AI', details: { version: body.app_version } }
      } catch (error) {
        return { success: false, message: mapError(error).message }
      }
    },
  }
}
