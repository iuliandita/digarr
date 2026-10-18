import { createHash } from 'node:crypto'
import { createHttpClient, HttpError } from './http'

const LISTENBRAINZ_ORIGIN = 'https://api.listenbrainz.org'
const LASTFM_ORIGIN = 'https://ws.audioscrobbler.com'
const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function safeFailure(provider: string, error: unknown): Error {
  return new Error(
    error instanceof HttpError
      ? `${provider} request failed (HTTP ${error.status})`
      : `${provider} request failed`,
  )
}

export async function loveListenBrainz(token: string, recordingMbid: string): Promise<void> {
  if (!MBID.test(recordingMbid)) throw new Error('A recording MBID is required')
  try {
    await createHttpClient({
      baseUrl: LISTENBRAINZ_ORIGIN,
      headers: { Authorization: `Token ${token}` },
    }).postVoid('/1/feedback/recording-feedback', { recording_mbid: recordingMbid, score: 1 })
  } catch (error) {
    throw safeFailure('ListenBrainz', error)
  }
}

export async function createListenBrainzPlaylist(
  token: string,
  title: string,
  tracks: Array<{ artistName: string; trackName: string; mbid?: string }>,
): Promise<void> {
  const recordings = tracks.filter((track) => track.mbid && MBID.test(track.mbid))
  if (!recordings.length) throw new Error('No recording MBIDs are available for this playlist')
  try {
    await createHttpClient({
      baseUrl: LISTENBRAINZ_ORIGIN,
      headers: { Authorization: `Token ${token}` },
    }).postVoid('/1/playlist/create', {
      playlist: {
        title,
        extension: { 'https://musicbrainz.org/doc/jspf#playlist': { public: false } },
        track: recordings.map((track) => ({
          title: track.trackName,
          creator: track.artistName,
          identifier: [`https://musicbrainz.org/recording/${track.mbid}`],
        })),
      },
    })
  } catch (error) {
    throw safeFailure('ListenBrainz', error)
  }
}

function signedParams(params: Record<string, string>, sharedSecret: string): URLSearchParams {
  const signature = createHash('md5')
    .update(
      Object.keys(params)
        .sort()
        .map((key) => `${key}${params[key]}`)
        .join('') + sharedSecret,
    )
    .digest('hex')
  return new URLSearchParams({ ...params, api_sig: signature, format: 'json' })
}

async function lastFmRequest(
  params: Record<string, string>,
  sharedSecret: string,
  post = false,
): Promise<Record<string, unknown>> {
  try {
    const http = createHttpClient({ baseUrl: LASTFM_ORIGIN, retries: 0 })
    const signed = signedParams(params, sharedSecret)
    const data = post
      ? await http.postForm<Record<string, unknown>>('/2.0/', signed)
      : await http.get<Record<string, unknown>>(`/2.0/?${signed}`)
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.error !== undefined) {
      throw new Error('Last.fm rejected the request')
    }
    return data
  } catch (error) {
    throw safeFailure('Last.fm', error)
  }
}

export async function requestLastFmToken(apiKey: string, sharedSecret: string): Promise<string> {
  const data = await lastFmRequest({ method: 'auth.getToken', api_key: apiKey }, sharedSecret)
  if (typeof data.token !== 'string' || !data.token) throw new Error('Last.fm returned no token')
  return data.token
}

export async function exchangeLastFmSession(
  apiKey: string,
  sharedSecret: string,
  requestToken: string,
): Promise<string> {
  const data = await lastFmRequest(
    { method: 'auth.getSession', api_key: apiKey, token: requestToken },
    sharedSecret,
  )
  const session = data.session
  if (
    !session ||
    typeof session !== 'object' ||
    !('key' in session) ||
    typeof session.key !== 'string' ||
    !session.key
  ) {
    throw new Error('Last.fm returned no session')
  }
  return session.key
}

export async function loveLastFm(params: {
  apiKey: string
  sharedSecret: string
  sessionKey: string
  artistName: string
  trackName: string
}): Promise<void> {
  await lastFmRequest(
    {
      method: 'track.love',
      api_key: params.apiKey,
      sk: params.sessionKey,
      artist: params.artistName,
      track: params.trackName,
    },
    params.sharedSecret,
    true,
  )
}
