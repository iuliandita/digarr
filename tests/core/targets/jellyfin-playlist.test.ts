// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlaylistItem } from '@/core/targets/types'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const { createJellyfinPlaylistTarget } = await import('@/core/targets/jellyfin-playlist')

const CONFIG = { url: 'http://jellyfin:8096', apiKey: 'jf-api-key', userId: 'user-uuid-1' }

function ok<T>(body: T): Response {
  return new Response(JSON.stringify(body))
}

function httpError(status: number): Response {
  return new Response('Error', { status })
}

afterEach(() => {
  mockFetch.mockReset()
})

describe('createJellyfinPlaylistTarget()', () => {
  it('has correct id, type, and capabilities', () => {
    const target = createJellyfinPlaylistTarget(7, CONFIG)
    expect(target.id).toBe('jellyfin-playlist-7')
    expect(target.type).toBe('jellyfin-playlist')
    expect(target.capabilities).toContain('createPlaylist')
    expect(target.capabilities).not.toContain('addArtist')
  })

  describe('testConnection()', () => {
    it('returns success with server info', async () => {
      mockFetch.mockResolvedValueOnce(ok({ ServerName: 'Home Media', Version: '10.9.0' }))

      const target = createJellyfinPlaylistTarget(7, CONFIG)
      const result = await target.testConnection()

      expect(result.success).toBe(true)
      expect(result.message).toContain('Home Media')
      expect(result.message).toContain('10.9.0')
    })

    it('sends X-Emby-Token header', async () => {
      mockFetch.mockResolvedValueOnce(ok({ ServerName: 'Test', Version: '10.9.0' }))

      const target = createJellyfinPlaylistTarget(7, CONFIG)
      await target.testConnection()

      const opts = mockFetch.mock.calls[0]?.[1] as RequestInit
      expect(new Headers(opts.headers).get('X-Emby-Token')).toBe('jf-api-key')
    })

    it('passes Bun TLS skip options when configured', async () => {
      mockFetch.mockResolvedValueOnce(ok({ ServerName: 'Test', Version: '10.9.0' }))

      const target = createJellyfinPlaylistTarget(7, {
        ...CONFIG,
        skipTlsVerify: true,
      })
      await target.testConnection()

      const opts = mockFetch.mock.calls[0]?.[1] as RequestInit
      expect(opts).toMatchObject({ tls: { rejectUnauthorized: false } })
    })

    it('returns failure when server is unreachable', async () => {
      mockFetch.mockRejectedValue(new Error('connect ECONNREFUSED'))

      const target = createJellyfinPlaylistTarget(7, CONFIG)
      const result = await target.testConnection()

      expect(result.success).toBe(false)
      expect(result.message).toContain('ECONNREFUSED')
    })

    it('returns failure on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce(httpError(401))

      const target = createJellyfinPlaylistTarget(7, CONFIG)
      const result = await target.testConnection()

      expect(result.success).toBe(false)
      expect(result.message).toContain('401')
    })
  })

  describe('createPlaylist()', () => {
    beforeEach(() => {
      mockFetch.mockImplementation(async (url: string | URL | Request, opts?: RequestInit) => {
        const urlStr = String(url)

        // GET /Users/{userId}/Items - track search
        if (urlStr.includes('/Items') && (!opts?.method || opts.method === 'GET')) {
          return ok({
            Items: [
              { Id: 'item-1', Name: 'Creep', AlbumArtist: 'Radiohead', Artists: ['Radiohead'] },
              {
                Id: 'item-2',
                Name: 'Karma Police',
                AlbumArtist: 'Radiohead',
                Artists: ['Radiohead'],
              },
            ],
            TotalRecordCount: 2,
          })
        }

        // POST /Playlists - create playlist
        if (urlStr.includes('/Playlists') && opts?.method === 'POST') {
          return ok({ Id: 'jf-pl-1', Name: 'Digarr Picks' })
        }

        return new Response('Not Found', { status: 404 })
      })
    })

    it('creates a playlist and returns success', async () => {
      const target = createJellyfinPlaylistTarget(7, CONFIG)
      const result = await target.createPlaylist?.('Digarr Picks', [
        { artistName: 'Radiohead', artistMbid: 'mbid-rh', trackName: 'Creep' },
        { artistName: 'Radiohead', artistMbid: 'mbid-rh', trackName: 'Karma Police' },
      ])

      expect(result?.success).toBe(true)
      expect(result?.playlistId).toBe('jf-pl-1')
      expect(result?.playlistName).toBe('Digarr Picks')
      expect(result?.itemsAdded).toBe(2)
      expect(result?.targetType).toBe('jellyfin-playlist')
      expect(result?.targetId).toBe(7)
    })

    it('skips items without trackName', async () => {
      const target = createJellyfinPlaylistTarget(7, CONFIG)
      const result = await target.createPlaylist?.('Artist Only', [
        { artistName: 'Radiohead', artistMbid: 'mbid-rh' },
      ])

      expect(result?.success).toBe(true)
      expect(result?.itemsAdded).toBe(0)

      // No search calls made
      const calls = mockFetch.mock.calls.map((c) => String(c[0]))
      const searchCalls = calls.filter((u) => u.includes('/Items') && !u.includes('/Playlists'))
      expect(searchCalls).toHaveLength(0)
    })

    it('handles tracks not found in Jellyfin gracefully', async () => {
      mockFetch.mockImplementation(async (url: string | URL | Request, opts?: RequestInit) => {
        const urlStr = String(url)
        if (urlStr.includes('/Items') && (!opts?.method || opts.method === 'GET')) {
          return ok({ Items: [], TotalRecordCount: 0 })
        }
        if (urlStr.includes('/Playlists') && opts?.method === 'POST') {
          return ok({ Id: 'jf-pl-empty', Name: 'Empty' })
        }
        return new Response('Not Found', { status: 404 })
      })

      const target = createJellyfinPlaylistTarget(7, CONFIG)
      const result = await target.createPlaylist?.('Empty Playlist', [
        { artistName: 'Ghost Band', artistMbid: 'mbid-x', trackName: 'Missing' },
      ])

      expect(result?.success).toBe(true)
      expect(result?.itemsAdded).toBe(0)
    })

    it('fails without creating a playlist when track search is forbidden', async () => {
      mockFetch.mockResolvedValueOnce(new Response('forbidden', { status: 403 }))

      const target = createJellyfinPlaylistTarget(7, CONFIG)
      const result = await target.createPlaylist?.('Forbidden', [
        { artistName: 'Radiohead', artistMbid: 'mbid-rh', trackName: 'Creep' },
      ])

      expect(result).toMatchObject({ success: false, error: 'Jellyfin API 403: forbidden' })
      expect(
        mockFetch.mock.calls.some(
          ([url, init]) =>
            String(url).includes('/Playlists') &&
            (init as RequestInit | undefined)?.method === 'POST',
        ),
      ).toBe(false)
    })

    it('returns failure when POST /Playlists errors', async () => {
      mockFetch.mockImplementation(async (url: string | URL | Request, opts?: RequestInit) => {
        const urlStr = String(url)
        if (urlStr.includes('/Items') && (!opts?.method || opts.method === 'GET')) {
          return ok({ Items: [], TotalRecordCount: 0 })
        }
        if (urlStr.includes('/Playlists') && opts?.method === 'POST') {
          return httpError(500)
        }
        return new Response('Not Found', { status: 404 })
      })

      const target = createJellyfinPlaylistTarget(7, CONFIG)
      const result = await target.createPlaylist?.('Bad', [
        { artistName: 'X', artistMbid: 'mbid-x', trackName: 'Y' },
      ])

      expect(result?.success).toBe(false)
      expect(result?.error).toContain('500')
      expect(result?.error).toContain('Error')
      expect(
        mockFetch.mock.calls.filter(
          ([url, init]) =>
            String(url).includes('/Playlists') &&
            (init as RequestInit | undefined)?.method === 'POST',
        ),
      ).toHaveLength(1)
    })

    it('returns a provider-shaped error for malformed JSON', async () => {
      mockFetch.mockResolvedValueOnce(new Response('not-json'))

      const target = createJellyfinPlaylistTarget(7, CONFIG)
      const result = await target.createPlaylist?.('Bad JSON', [])

      expect(result).toMatchObject({
        success: false,
        error: 'Jellyfin API 200: Invalid JSON: not-json',
      })
    })

    it('redacts the API key if an upstream error body echoes it', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(`apiKey=${CONFIG.apiKey}`, {
          status: 500,
        }),
      )

      const target = createJellyfinPlaylistTarget(7, CONFIG)
      const result = await target.createPlaylist?.('Echoed Credential', [])

      expect(result).toMatchObject({
        success: false,
        error: 'Jellyfin API 500: apiKey=[REDACTED]',
      })
      expect(result?.error).not.toContain(CONFIG.apiKey)
    })

    it('returns a provider-shaped error for an empty JSON response', async () => {
      mockFetch.mockResolvedValueOnce(new Response(''))

      const target = createJellyfinPlaylistTarget(7, CONFIG)
      const result = await target.createPlaylist?.('Empty Response', [])

      expect(result).toMatchObject({
        success: false,
        error: 'Jellyfin API 200: Expected JSON response body',
      })
    })

    it('prefers exact artist+title match in search results', async () => {
      mockFetch.mockImplementation(async (url: string | URL | Request, opts?: RequestInit) => {
        const urlStr = String(url)
        if (urlStr.includes('/Items') && (!opts?.method || opts.method === 'GET')) {
          return ok({
            Items: [
              // Partial match first
              {
                Id: 'item-partial',
                Name: 'Creep (Acoustic)',
                AlbumArtist: 'Radiohead',
                Artists: ['Radiohead'],
              },
              // Exact match second
              { Id: 'item-exact', Name: 'Creep', AlbumArtist: 'Radiohead', Artists: ['Radiohead'] },
            ],
            TotalRecordCount: 2,
          })
        }
        if (urlStr.includes('/Playlists') && opts?.method === 'POST') {
          const body = JSON.parse(opts.body as string) as { Ids: string[] }
          // Check which ID was passed
          return ok({ Id: 'jf-pl-x', Name: 'T', _passedIds: body.Ids })
        }
        return new Response('Not Found', { status: 404 })
      })

      const target = createJellyfinPlaylistTarget(7, CONFIG)
      const result = await target.createPlaylist?.('Test', [
        { artistName: 'Radiohead', artistMbid: 'mbid-rh', trackName: 'Creep' },
      ])

      // Find the POST /Playlists call and check passed IDs
      const postCall = mockFetch.mock.calls.find((c) => {
        const [u, o] = c as [string, RequestInit | undefined]
        return String(u).includes('/Playlists') && o?.method === 'POST'
      })
      const body = JSON.parse(postCall?.[1]?.body as string) as { Ids: string[] }
      expect(body.Ids).toContain('item-exact')
      expect(body.Ids).not.toContain('item-partial')
      expect(result?.success).toBe(true)
    })
  })
})

const EXPORT_ITEMS = [
  { artistName: 'Radiohead', artistMbid: 'mbid-rh', trackName: 'Creep' },
  { artistName: 'Other', artistMbid: 'other', trackName: 'Missing' },
]

function exportFetch(
  options: {
    identity?: unknown
    user?: unknown
    entries?: unknown
    addStatus?: number
    metadata?: unknown
  } = {},
) {
  return vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
    const request = new URL(url)
    if (request.pathname === '/System/Info') return ok(options.identity ?? { Id: 'server-1' })
    if (request.pathname === '/Users/user-uuid-1')
      return ok(options.user ?? { Id: CONFIG.userId, ServerId: 'server-1' })
    if (request.pathname === '/Users/user-uuid-1/Items') {
      return ok({ Items: [{ Id: 'track-1', Name: 'Creep', Artists: ['Radiohead'] }] })
    }
    if (request.pathname === '/Users/user-uuid-1/Items/playlist-1') {
      return ok(
        options.metadata ?? {
          Id: 'playlist-1',
          Type: 'Playlist',
          MediaType: 'Audio',
          Name: 'Original name',
        },
      )
    }
    if (request.pathname === '/Playlists') return ok({ Id: 'playlist-1' })
    if (init.method === 'GET') {
      return ok(
        options.entries ?? {
          Items: [{ Id: 'audio-9', PlaylistItemId: 'entry-1' }],
          TotalRecordCount: 1,
        },
      )
    }
    return new Response(null, {
      status: options.addStatus && init.method === 'POST' ? options.addStatus : 204,
    })
  })
}

function mutations(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([, init]) => (init as RequestInit).method !== 'GET')
}

describe('Jellyfin scheduled playlist session', () => {
  it('checkpoints creation immediately and retains the known ID when persistence fails', async () => {
    const fetchMock = exportFetch()
    mockFetch.mockImplementation(fetchMock)
    const session = await createJellyfinPlaylistTarget(7, CONFIG).openPlaylistExportSession?.(
      EXPORT_ITEMS,
    )
    expect(mutations(fetchMock)).toHaveLength(0)
    const checkpoint = vi.fn().mockImplementation(async (id: string) => {
      expect(id).toBe('playlist-1')
      expect(mutations(fetchMock)).toHaveLength(1)
      throw new Error(`save failed ${CONFIG.apiKey}`)
    })
    expect(await session?.createPlaylist('Picks', checkpoint)).toMatchObject({
      success: false,
      playlistId: 'playlist-1',
      error: 'save failed [REDACTED]',
    })
    expect(checkpoint).toHaveBeenCalledOnce()
    expect(mutations(fetchMock)).toHaveLength(1)
  })

  it('replaces entry IDs on the same playlist and preserves its metadata', async () => {
    const fetchMock = exportFetch()
    mockFetch.mockImplementation(fetchMock)
    const session = await createJellyfinPlaylistTarget(7, CONFIG).openPlaylistExportSession?.(
      EXPORT_ITEMS,
    )
    expect(await session?.replacePlaylist('playlist-1', 'New name')).toMatchObject({
      success: true,
      playlistId: 'playlist-1',
      playlistName: 'Original name',
      itemsAdded: 1,
      itemsSkipped: 1,
    })
    const writes = mutations(fetchMock)
    expect(writes.map(([, init]) => init.method)).toEqual(['DELETE', 'POST'])
    expect(new URL(writes[0]?.[0]).searchParams.get('EntryIds')).toBe('entry-1')
    expect(new URL(writes[1]?.[0]).searchParams.get('Ids')).toBe('track-1')
    expect(writes.every(([url]) => new URL(url).pathname === '/Playlists/playlist-1/Items')).toBe(
      true,
    )
  })

  it('collects every page before removing any item', async () => {
    const fetchMock = exportFetch()
    mockFetch.mockImplementation(async (url: string, init: RequestInit) => {
      const request = new URL(url)
      if (request.pathname === '/Playlists/playlist-1/Items' && init.method === 'GET') {
        expect(mutations(fetchMock)).toHaveLength(0)
        const entry = request.searchParams.get('StartIndex') === '0' ? 'entry-1' : 'entry-2'
        return ok({ Items: [{ PlaylistItemId: entry }], TotalRecordCount: 2 })
      }
      return fetchMock(url, init)
    })
    const session = await createJellyfinPlaylistTarget(7, CONFIG).openPlaylistExportSession?.(
      EXPORT_ITEMS,
    )
    expect((await session?.replacePlaylist('playlist-1', 'Picks'))?.success).toBe(true)
    const writes = mutations(fetchMock)
    expect(new URL(writes[0]?.[0]).searchParams.get('EntryIds')).toBe('entry-1,entry-2')
  })

  it.each([
    { entries: { Items: [], TotalRecordCount: 1 } },
    { entries: { Items: [{ PlaylistItemId: 'entry-1' }], TotalRecordCount: 2 } },
    { entries: { Items: [{ Id: 'audio-1' }], TotalRecordCount: 1 } },
    { entries: { Items: [], TotalRecordCount: -1 } },
    { metadata: { Id: 'playlist-1', Type: 'Audio', MediaType: 'Audio' } },
  ])(
    'refuses incomplete, repeated, or invalid remote data without clearing it: %j',
    async (options) => {
      const fetchMock = exportFetch(options)
      mockFetch.mockImplementation(fetchMock)
      const session = await createJellyfinPlaylistTarget(7, CONFIG).openPlaylistExportSession?.(
        EXPORT_ITEMS,
      )
      expect(await session?.replacePlaylist('playlist-1', 'Picks')).toMatchObject({
        success: false,
        playlistId: 'playlist-1',
      })
      expect(mutations(fetchMock)).toHaveLength(0)
    },
  )

  it.each([
    { identity: {} },
    { user: { Id: 'different-user' } },
    { user: { Id: CONFIG.userId, ServerId: 'different-server' } },
  ])('rejects unverified identities before any mutation: %j', async (options) => {
    const fetchMock = exportFetch(options)
    mockFetch.mockImplementation(fetchMock)
    await expect(
      createJellyfinPlaylistTarget(7, CONFIG).openPlaylistExportSession?.(EXPORT_ITEMS),
    ).rejects.toThrow()
    expect(mutations(fetchMock)).toHaveLength(0)
  })

  it.each([
    { items: [] as PlaylistItem[], error: 'No playlist tracks were provided' },
    {
      items: [{ artistName: 'Other', artistMbid: 'other', trackName: 'Missing' }],
      error: 'No playlist tracks were found in the Jellyfin library',
    },
  ])('refuses empty or all-unmatched scheduled exports: $error', async ({ items, error }) => {
    const fetchMock = exportFetch()
    mockFetch.mockImplementation(fetchMock)
    await expect(
      createJellyfinPlaylistTarget(7, CONFIG).openPlaylistExportSession?.(items),
    ).rejects.toThrow(error)
    expect(mutations(fetchMock)).toHaveLength(0)
  })

  it.each([404, 403, 500])(
    'retains the ID on update failure %i and never creates a replacement',
    async (status) => {
      const fetchMock = exportFetch({ addStatus: status })
      mockFetch.mockImplementation(fetchMock)
      const session = await createJellyfinPlaylistTarget(7, CONFIG).openPlaylistExportSession?.(
        EXPORT_ITEMS,
      )
      expect(await session?.replacePlaylist('playlist-1', 'Picks')).toMatchObject({
        success: false,
        playlistId: 'playlist-1',
      })
      expect(mutations(fetchMock)).toHaveLength(2)
      expect(await session?.replacePlaylist('playlist-1', 'Picks')).toMatchObject({
        success: false,
        playlistId: 'playlist-1',
      })
      expect(mutations(fetchMock)).toHaveLength(4)
      expect(
        mutations(fetchMock).every(
          ([url]) => new URL(url).pathname === '/Playlists/playlist-1/Items',
        ),
      ).toBe(true)
    },
  )

  it.each([404, 403])(
    'does not recreate a missing or inaccessible saved playlist (%i)',
    async (status) => {
      const fetchMock = exportFetch()
      mockFetch.mockImplementation((url: string, init: RequestInit) =>
        new URL(url).pathname === '/Users/user-uuid-1/Items/playlist-1'
          ? Promise.resolve(new Response('unavailable', { status }))
          : fetchMock(url, init),
      )
      const session = await createJellyfinPlaylistTarget(7, CONFIG).openPlaylistExportSession?.(
        EXPORT_ITEMS,
      )
      expect(await session?.replacePlaylist('playlist-1', 'Picks')).toMatchObject({
        success: false,
        playlistId: 'playlist-1',
      })
      expect(mutations(fetchMock)).toHaveLength(0)
    },
  )

  it('keeps verified credential rotation in scope and freezes request credentials', async () => {
    const fetchMock = exportFetch()
    mockFetch.mockImplementation(fetchMock)
    const config = { ...CONFIG }
    const target = createJellyfinPlaylistTarget(7, config)
    const first = await target.openPlaylistExportSession?.(EXPORT_ITEMS)
    config.apiKey = 'rotated-api-key'
    const second = await createJellyfinPlaylistTarget(7, config).openPlaylistExportSession?.(
      EXPORT_ITEMS,
    )
    expect(first?.scope).toBe(second?.scope)
    expect(first?.scope).not.toContain(CONFIG.apiKey)
    await first?.createPlaylist('Picks', async () => {})
    const [, init] = mutations(fetchMock).at(-1) ?? []
    expect(new Headers(init.headers).get('X-Emby-Token')).toBe(CONFIG.apiKey)
  })
})
