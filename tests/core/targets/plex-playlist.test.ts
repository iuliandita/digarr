// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPlexPlaylistTarget } from '@/core/targets/plex-playlist'

const CONFIG = {
  url: 'http://plex:32400/',
  token: 'plex-secret-token',
}

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body))
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createPlexPlaylistTarget', () => {
  it('returns connection metadata and sends the Plex token header', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      ok({
        MediaContainer: {
          friendlyName: 'Home Plex',
          version: '1.41.0',
          machineIdentifier: 'machine-1',
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await createPlexPlaylistTarget(4, CONFIG).testConnection()

    expect(result).toMatchObject({
      success: true,
      details: { machineIdentifier: 'machine-1', version: '1.41.0' },
    })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://plex:32400/')
    expect(new Headers(init.headers).get('X-Plex-Token')).toBe(CONFIG.token)
  })

  it('uses the exact search match when creating a playlist', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string | URL | Request) => {
      const value = String(url)
      if (value.includes('/hubs/search')) {
        return Promise.resolve(
          ok({
            MediaContainer: {
              Hub: [
                {
                  type: 'track',
                  Metadata: [
                    {
                      ratingKey: 'partial',
                      title: 'Creep (Live)',
                      grandparentTitle: 'Radiohead',
                      type: 'track',
                    },
                    {
                      ratingKey: 'exact',
                      title: 'Creep',
                      grandparentTitle: 'Radiohead',
                      type: 'track',
                    },
                  ],
                },
              ],
            },
          }),
        )
      }
      if (value.includes('/playlists?')) {
        return Promise.resolve(
          ok({ MediaContainer: { Metadata: [{ ratingKey: 'playlist-1', title: 'Picks' }] } }),
        )
      }
      return Promise.resolve(ok({ MediaContainer: { machineIdentifier: 'machine-1' } }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await createPlexPlaylistTarget(4, CONFIG).createPlaylist?.('Picks', [
      { artistName: 'Radiohead', artistMbid: 'mbid-rh', trackName: 'Creep' },
    ])

    expect(result).toMatchObject({ success: true, playlistId: 'playlist-1', itemsAdded: 1 })
    const createUrl = String(
      fetchMock.mock.calls.find(([url]) => String(url).includes('/playlists?'))?.[0],
    )
    expect(decodeURIComponent(createUrl)).toContain('/metadata/exact')
    expect(decodeURIComponent(createUrl)).not.toContain('/metadata/partial')
  })

  it('makes one playlist-create request and retains a redacted HTTP body', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string | URL | Request) => {
      if (String(url).includes('/playlists?')) {
        return Promise.resolve(new Response(`token=${CONFIG.token}`, { status: 500 }))
      }
      return Promise.resolve(ok({ MediaContainer: { machineIdentifier: 'machine-1' } }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await createPlexPlaylistTarget(4, CONFIG).createPlaylist?.('Picks', [])

    expect(result).toMatchObject({
      success: false,
      error: 'Plex API 500: token=[REDACTED]',
    })
    expect(result?.error).not.toContain(CONFIG.token)
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes('/playlists?')),
    ).toHaveLength(1)
  })

  it('returns a provider-shaped error for malformed JSON', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string | URL | Request) => {
      if (String(url).includes('/playlists?')) return Promise.resolve(new Response('not-json'))
      return Promise.resolve(ok({ MediaContainer: { machineIdentifier: 'machine-1' } }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await createPlexPlaylistTarget(4, CONFIG).createPlaylist?.('Picks', [])

    expect(result).toMatchObject({
      success: false,
      error: 'Plex API 200: Invalid JSON: not-json',
    })
  })

  it('returns timeout failures without exposing the token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new DOMException('request timed out', 'AbortError')),
    )

    const result = await createPlexPlaylistTarget(4, CONFIG).testConnection()

    expect(result).toMatchObject({ success: false, message: 'request timed out' })
    expect(result.message).not.toContain(CONFIG.token)
  })
})
