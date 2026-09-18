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

const ITEM = { artistName: 'Radiohead', artistMbid: 'mbid-rh', trackName: 'Creep' }

function trackResponse(ratingKey = '101', title = 'Creep'): Response {
  return ok({
    MediaContainer: {
      Hub: [
        {
          type: 'track',
          Metadata: [{ ratingKey, title, grandparentTitle: 'Radiohead', type: 'track' }],
        },
      ],
    },
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createPlexPlaylistTarget', () => {
  it.each([undefined, '', '   '])('rejects a connection without a server identity', async (id) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(ok({ MediaContainer: { machineIdentifier: id } })),
    )
    expect(await createPlexPlaylistTarget(4, CONFIG).testConnection()).toMatchObject({
      success: false,
      message: 'Plex did not return a server machine identifier',
    })
  })

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
      if (String(url).includes('/hubs/search')) return Promise.resolve(trackResponse())
      if (String(url).includes('/playlists?')) {
        return Promise.resolve(new Response(`token=${CONFIG.token}`, { status: 500 }))
      }
      return Promise.resolve(ok({ MediaContainer: { machineIdentifier: 'machine-1' } }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await createPlexPlaylistTarget(4, CONFIG).createPlaylist?.('Picks', [ITEM])

    expect(result).toMatchObject({
      success: false,
      error: 'Plex API 500: token=[REDACTED]',
    })
    expect(result?.error).not.toContain(CONFIG.token)
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes('/playlists?')),
    ).toHaveLength(1)
  })

  it('fails without creating a playlist when track search is forbidden', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('forbidden', { status: 403 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await createPlexPlaylistTarget(4, CONFIG).createPlaylist?.('Picks', [
      { artistName: 'Radiohead', artistMbid: 'mbid-rh', trackName: 'Creep' },
    ])

    expect(result).toMatchObject({ success: false, error: 'Plex API 403: forbidden' })
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/playlists?'))).toBe(false)
  })

  it('returns a provider-shaped error for malformed JSON', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string | URL | Request) => {
      if (String(url).includes('/hubs/search')) return Promise.resolve(trackResponse())
      if (String(url).includes('/playlists?')) return Promise.resolve(new Response('not-json'))
      return Promise.resolve(ok({ MediaContainer: { machineIdentifier: 'machine-1' } }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await createPlexPlaylistTarget(4, CONFIG).createPlaylist?.('Picks', [ITEM])

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

  it('sends one content URI containing all tracks in order without an empty JSON body', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init: RequestInit) => {
      const requestUrl = new URL(url)
      if (requestUrl.pathname === '/hubs/search') {
        return Promise.resolve(
          requestUrl.searchParams.get('query')?.includes('Creep')
            ? trackResponse('101', 'Creep')
            : trackResponse('202', 'No Surprises'),
        )
      }
      if (requestUrl.pathname === '/playlists') {
        expect(init.method).toBe('POST')
        expect(init.body).toBeUndefined()
        expect(new Headers(init.headers).get('Content-Type')).toBe(
          'application/x-www-form-urlencoded',
        )
        expect(new Headers(init.headers).get('X-Plex-Token')).toBe(CONFIG.token)
        expect(requestUrl.searchParams.getAll('uri')).toEqual([
          'server://machine-1/com.plexapp.plugins.library/library/metadata/101,202',
        ])
        expect(requestUrl.searchParams.get('title')).toBe('Picks & favorites')
        expect(requestUrl.searchParams.get('type')).toBe('audio')
        expect(requestUrl.searchParams.get('smart')).toBe('0')
        return Promise.resolve(
          ok({ MediaContainer: { Metadata: [{ ratingKey: '99', title: 'Picks & favorites' }] } }),
        )
      }
      return Promise.resolve(ok({ MediaContainer: { machineIdentifier: 'machine-1' } }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await createPlexPlaylistTarget(4, CONFIG).createPlaylist?.('Picks & favorites', [
      ITEM,
      { ...ITEM, trackName: 'No Surprises' },
    ])
    expect(result).toMatchObject({ success: true, itemsAdded: 2 })
  })

  it.each([{ items: [] }, { items: [ITEM] }])(
    'does not send an empty playlist when no local tracks resolve',
    async ({ items }) => {
      const fetchMock = vi.fn().mockResolvedValue(ok({ MediaContainer: { Hub: [] } }))
      vi.stubGlobal('fetch', fetchMock)
      const result = await createPlexPlaylistTarget(4, CONFIG).createPlaylist?.('Picks', items)
      expect(result).toMatchObject({
        success: false,
        error: 'No playlist tracks were found in the Plex library',
      })
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/playlists?'))).toBe(false)
    },
  )

  it('refuses to create a playlist with a missing server identifier', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(
          url.includes('/hubs/search') ? trackResponse() : ok({ MediaContainer: {} }),
        ),
      )
    vi.stubGlobal('fetch', fetchMock)
    const result = await createPlexPlaylistTarget(4, CONFIG).createPlaylist?.('Picks', [ITEM])
    expect(result).toMatchObject({
      success: false,
      error: 'Plex did not return a server machine identifier',
    })
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/playlists?'))).toBe(false)
  })
})
