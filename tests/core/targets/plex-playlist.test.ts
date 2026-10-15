// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPlexPlaylistTarget } from '@/core/targets/plex-playlist'
import type { PlaylistItem } from '@/core/targets/types'

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

function sessionFetch(
  options: { machineId?: unknown; metadata?: unknown; addStatus?: number; create?: unknown } = {},
) {
  return vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
    const request = new URL(url)
    if (request.pathname === '/')
      return ok({
        MediaContainer: {
          machineIdentifier: 'machineId' in options ? options.machineId : 'machine-1',
        },
      })
    if (request.pathname === '/hubs/search') return trackResponse()
    if (request.pathname === '/playlists')
      return ok(
        options.create ?? { MediaContainer: { Metadata: [{ ratingKey: '99', title: 'Picks' }] } },
      )
    if (init.method === 'GET')
      return ok({
        MediaContainer: {
          Metadata: [
            options.metadata ?? {
              ratingKey: '99',
              type: 'playlist',
              playlistType: 'audio',
              smart: false,
              title: 'Original',
            },
          ],
        },
      })
    return new Response(
      init.method === 'PUT' && options.addStatus ? `failed ${CONFIG.token}` : null,
      { status: init.method === 'PUT' && options.addStatus ? options.addStatus : 204 },
    )
  })
}

function sessionWrites(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([, init]) => (init as RequestInit).method !== 'GET')
}

describe('Plex scheduled playlist session', () => {
  it('checkpoints the validated new ID before returning and retains it when persistence fails', async () => {
    const fetchMock = sessionFetch()
    vi.stubGlobal('fetch', fetchMock)
    const session = await createPlexPlaylistTarget(4, CONFIG).openPlaylistExportSession?.([ITEM])
    expect(sessionWrites(fetchMock)).toHaveLength(0)
    const checkpoint = vi.fn().mockImplementation(async (id: string) => {
      expect(id).toBe('99')
      expect(sessionWrites(fetchMock)).toHaveLength(1)
      throw new Error(`save failed ${CONFIG.token}`)
    })
    expect(await session?.createPlaylist('Picks', checkpoint)).toMatchObject({
      success: false,
      playlistId: '99',
      error: 'save failed [REDACTED]',
    })
    expect(checkpoint).toHaveBeenCalledOnce()
    expect(sessionWrites(fetchMock)).toHaveLength(1)
  })

  it('clears and populates the bound dumb audio playlist without recreating or renaming it', async () => {
    const fetchMock = sessionFetch()
    vi.stubGlobal('fetch', fetchMock)
    const session = await createPlexPlaylistTarget(4, CONFIG).openPlaylistExportSession?.([ITEM])
    expect(await session?.replacePlaylist('99', 'New name')).toMatchObject({
      success: true,
      playlistId: '99',
      playlistName: 'Original',
      itemsAdded: 1,
    })
    const writes = sessionWrites(fetchMock)
    expect(writes.map(([, init]) => init.method)).toEqual(['DELETE', 'PUT'])
    expect(writes.every(([url]) => new URL(url).pathname === '/playlists/99/items')).toBe(true)
    expect(new URL(writes[1]?.[0]).searchParams.get('uri')).toBe(
      'server://machine-1/com.plexapp.plugins.library/library/metadata/101',
    )
    expect(writes[1]?.[1].body).toBeUndefined()
  })

  it.each([
    { ratingKey: '99', type: 'playlist', playlistType: 'audio', smart: true },
    { ratingKey: '99', type: 'playlist', playlistType: 'video', smart: false },
    { ratingKey: 'other', type: 'playlist', playlistType: 'audio', smart: false },
    { ratingKey: '99', type: 'playlist', playlistType: 'audio' },
    { ratingKey: '99', type: 'track', playlistType: 'audio', smart: false },
  ])('leaves the playlist unchanged when remote metadata does not match: %j', async (metadata) => {
    const fetchMock = sessionFetch({ metadata })
    vi.stubGlobal('fetch', fetchMock)
    const session = await createPlexPlaylistTarget(4, CONFIG).openPlaylistExportSession?.([ITEM])
    expect(await session?.replacePlaylist('99', 'Picks')).toMatchObject({
      success: false,
      playlistId: '99',
    })
    expect(sessionWrites(fetchMock)).toHaveLength(0)
  })

  it.each([404, 403, 500])(
    'retains the same ID and redacts a mid-replace failure %i without retry or recreation',
    async (status) => {
      const fetchMock = sessionFetch({ addStatus: status })
      vi.stubGlobal('fetch', fetchMock)
      const session = await createPlexPlaylistTarget(4, CONFIG).openPlaylistExportSession?.([ITEM])
      expect(await session?.replacePlaylist('99', 'Picks')).toMatchObject({
        success: false,
        playlistId: '99',
        error: `Plex API ${status}: failed [REDACTED]`,
      })
      expect(sessionWrites(fetchMock)).toHaveLength(2)
      expect(await session?.replacePlaylist('99', 'Picks')).toMatchObject({
        success: false,
        playlistId: '99',
      })
      expect(sessionWrites(fetchMock)).toHaveLength(4)
      expect(
        sessionWrites(fetchMock).every(([url]) => new URL(url).pathname === '/playlists/99/items'),
      ).toBe(true)
    },
  )

  it.each([undefined, '', '  ', 'machine/invalid'])(
    'rejects invalid identity %j before any write',
    async (machineId) => {
      const fetchMock = sessionFetch({ machineId })
      vi.stubGlobal('fetch', fetchMock)
      await expect(
        createPlexPlaylistTarget(4, CONFIG).openPlaylistExportSession?.([ITEM]),
      ).rejects.toThrow('server machine identifier')
      expect(sessionWrites(fetchMock)).toHaveLength(0)
    },
  )

  it.each([
    { items: [] as PlaylistItem[], error: 'No playlist tracks were provided' },
    {
      items: [{ ...ITEM, trackName: undefined }],
      error: 'No playlist tracks were found in the Plex library',
    },
  ])('refuses an export with no resolved tracks: $error', async ({ items, error }) => {
    const fetchMock = sessionFetch()
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      createPlexPlaylistTarget(4, CONFIG).openPlaylistExportSession?.(items),
    ).rejects.toThrow(error)
    expect(sessionWrites(fetchMock)).toHaveLength(0)
  })

  it.each([404, 403])(
    'does not recreate a missing or inaccessible saved playlist (%i)',
    async (status) => {
      const fetchMock = sessionFetch()
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockImplementation((url: string, init: RequestInit) =>
            new URL(url).pathname === '/playlists/99' && init.method === 'GET'
              ? Promise.resolve(new Response('unavailable', { status }))
              : fetchMock(url, init),
          ),
      )
      const session = await createPlexPlaylistTarget(4, CONFIG).openPlaylistExportSession?.([ITEM])
      expect(await session?.replacePlaylist('99', 'Picks')).toMatchObject({
        success: false,
        playlistId: '99',
      })
      expect(sessionWrites(fetchMock)).toHaveLength(0)
    },
  )

  it('binds the scope to the server and token snapshot without exposing the token', async () => {
    const fetchMock = sessionFetch()
    vi.stubGlobal('fetch', fetchMock)
    const config = { ...CONFIG }
    const first = await createPlexPlaylistTarget(4, config).openPlaylistExportSession?.([ITEM])
    const same = await createPlexPlaylistTarget(4, config).openPlaylistExportSession?.([ITEM])
    config.token = 'rotated-token'
    const rotated = await createPlexPlaylistTarget(4, config).openPlaylistExportSession?.([ITEM])
    expect(first?.scope).toBe(same?.scope)
    expect(first?.scope).not.toBe(rotated?.scope)
    expect(first?.scope).not.toContain(CONFIG.token)
    await first?.createPlaylist('Picks', async () => {})
    expect(new Headers(sessionWrites(fetchMock).at(-1)?.[1].headers).get('X-Plex-Token')).toBe(
      CONFIG.token,
    )
  })

  it.each([{}, { MediaContainer: { Metadata: [{ ratingKey: '../invalid', title: 'Picks' }] } }])(
    'does not checkpoint an invalid create response: %j',
    async (create) => {
      const fetchMock = sessionFetch({ create })
      vi.stubGlobal('fetch', fetchMock)
      const session = await createPlexPlaylistTarget(4, CONFIG).openPlaylistExportSession?.([ITEM])
      const checkpoint = vi.fn()
      expect(await session?.createPlaylist('Picks', checkpoint)).toMatchObject({ success: false })
      expect(checkpoint).not.toHaveBeenCalled()
      expect(sessionWrites(fetchMock)).toHaveLength(1)
    },
  )
})
