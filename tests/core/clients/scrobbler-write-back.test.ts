// @vitest-environment node
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { redactUrlForLog } from '@/core/clients/http'
import {
  createListenBrainzPlaylist,
  exchangeLastFmSession,
  loveLastFm,
  loveListenBrainz,
  requestLastFmToken,
} from '@/core/clients/scrobbler-write-back'

const MBID = '9f24c0f7-a644-4074-8fbd-a1dba03de129'
const track = { artistName: 'Björk & friends', trackName: 'A + B', mbid: MBID }
const credentials = { apiKey: 'api-key', sharedSecret: 'secret', sessionKey: 'session' }

afterEach(() => vi.restoreAllMocks())

describe('scrobbler write-back clients', () => {
  it('posts one loved recording and a JSPF playlist with recording identifiers', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}'))
    await loveListenBrainz('lb-token', MBID)
    await createListenBrainzPlaylist('lb-token', 'Approved', [
      track,
      { artistName: 'Missing', trackName: 'ID' },
    ])
    const [feedbackUrl, feedback] = fetch.mock.calls[0] ?? []
    expect(feedbackUrl).toBe('https://api.listenbrainz.org/1/feedback/recording-feedback')
    expect(feedback?.method).toBe('POST')
    expect(new Headers(feedback?.headers).get('Authorization')).toBe('Token lb-token')
    expect(JSON.parse(String(feedback?.body))).toEqual({ recording_mbid: MBID, score: 1 })
    const [playlistUrl, playlist] = fetch.mock.calls[1] ?? []
    expect(playlistUrl).toBe('https://api.listenbrainz.org/1/playlist/create')
    expect(JSON.parse(String(playlist?.body))).toEqual({
      playlist: {
        title: 'Approved',
        extension: { 'https://musicbrainz.org/doc/jspf#playlist': { public: false } },
        track: [
          {
            title: track.trackName,
            creator: track.artistName,
            identifier: [`https://musicbrainz.org/recording/${MBID}`],
          },
        ],
      },
    })
    expect(playlist?.redirect).toBe('manual')
  })

  it('signs UTF-8 Last.fm love parameters and sends every parameter in a form body', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
    await loveLastFm({ ...credentials, ...track })
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe('https://ws.audioscrobbler.com/2.0/')
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/x-www-form-urlencoded')
    const params = new URLSearchParams(String(init?.body))
    expect(params.get('artist')).toBe(track.artistName)
    expect(params.get('track')).toBe(track.trackName)
    expect(params.get('method')).toBe('track.love')
    expect(params.get('api_sig')).toBe(
      createHash('md5')
        .update(
          `api_keyapi-keyartist${track.artistName}methodtrack.lovesksessiontrack${track.trackName}secret`,
        )
        .digest('hex'),
    )
    expect(params.get('format')).toBe('json')
    expect(
      redactUrlForLog(
        `https://example.com/?api_sig=${params.get('api_sig')}&token=request-token&sk=session`,
      ),
    ).not.toContain(params.get('api_sig'))
  })

  it('fetches a signed request token and exchanges only that token for a session', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{"token":"request-token"}'))
      .mockResolvedValueOnce(new Response('{"session":{"key":"session-key"}}'))
    await expect(requestLastFmToken('api-key', 'secret')).resolves.toBe('request-token')
    await expect(exchangeLastFmSession('api-key', 'secret', 'request-token')).resolves.toBe(
      'session-key',
    )
    const url = new URL(String(fetch.mock.calls[1]?.[0]))
    expect(url.searchParams.get('token')).toBe('request-token')
    expect(url.searchParams.get('api_sig')).toBe(
      createHash('md5')
        .update('api_keyapi-keymethodauth.getSessiontokenrequest-tokensecret')
        .digest('hex'),
    )
  })

  it.each(['http', 'json', 'network', 'redirect'] as const)(
    'does not leak credentials or retry write failures: %s',
    async (failure) => {
      const fetch = vi.spyOn(globalThis, 'fetch')
      const leaked = 'secret api-key session lb-token request-token api_sig=signature'
      const respond = () =>
        failure === 'network'
          ? Promise.reject(new Error(leaked))
          : Promise.resolve(
              new Response(
                failure === 'json' ? JSON.stringify({ error: 9, message: leaked }) : leaked,
                {
                  status: failure === 'http' ? 503 : failure === 'redirect' ? 302 : 200,
                  headers:
                    failure === 'redirect'
                      ? { location: `https://example.com/?token=${leaked}` }
                      : {},
                },
              ),
            )
      fetch.mockImplementation(respond)
      await expect(loveLastFm({ ...credentials, ...track })).rejects.toThrow(
        /^Last.fm request failed(?: \(HTTP \d+\))?$/,
      )
      expect(fetch).toHaveBeenCalledTimes(1)
      if (failure !== 'json') {
        await expect(loveListenBrainz('lb-token', MBID)).rejects.toThrow(
          /^ListenBrainz request failed(?: \(HTTP \d+\))?$/,
        )
        expect(fetch).toHaveBeenCalledTimes(2)
      }
    },
  )
})
