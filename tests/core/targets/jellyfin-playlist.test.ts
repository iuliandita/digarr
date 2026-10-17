// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
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

  describe('export session createPlaylist()', () => {
    function mockCreateResponse(create: () => Response) {
      mockFetch.mockImplementation(async (url: string | URL | Request) => {
        const { pathname } = new URL(String(url))
        if (pathname === '/System/Info') return ok({ Id: 'jf-server' })
        if (pathname === '/Users/user-uuid-1') return ok({ Id: 'user-uuid-1' })
        if (pathname === '/Users/user-uuid-1/Items') {
          return ok({ Items: [{ Id: 'item-1', Name: 'Creep', AlbumArtist: 'Radiohead' }] })
        }
        if (pathname === '/Playlists') return create()
        return new Response('Not Found', { status: 404 })
      })
    }

    async function createViaSession() {
      const session = await createJellyfinPlaylistTarget(7, CONFIG).openPlaylistExportSession?.([
        { artistName: 'Radiohead', artistMbid: 'mbid-rh', trackName: 'Creep' },
      ])
      if (!session) throw new Error('Expected an export session')
      return session.createPlaylist('Digarr Picks', async () => {})
    }

    it('returns failure when POST /Playlists errors', async () => {
      mockCreateResponse(() => httpError(500))

      const result = await createViaSession()

      expect(result.success).toBe(false)
      expect(result.error).toContain('500')
      expect(result.error).toContain('Error')
      expect(
        mockFetch.mock.calls.filter(([url]) => new URL(String(url)).pathname === '/Playlists'),
      ).toHaveLength(1)
    })

    it('redacts the API key if an upstream error body echoes it', async () => {
      mockCreateResponse(() => new Response(`apiKey=${CONFIG.apiKey}`, { status: 500 }))

      const result = await createViaSession()

      expect(result).toMatchObject({
        success: false,
        error: 'Jellyfin API 500: apiKey=[REDACTED]',
      })
      expect(result.error).not.toContain(CONFIG.apiKey)
    })

    it('returns a provider-shaped error for an empty JSON response', async () => {
      mockCreateResponse(() => new Response(''))

      expect(await createViaSession()).toMatchObject({
        success: false,
        error: 'Jellyfin API 200: Expected JSON response body',
      })
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
    expect(writes.map(([, init]) => init.method)).toEqual(['POST', 'DELETE'])
    expect(new URL(writes[0]?.[0]).searchParams.get('Ids')).toBe('track-1')
    expect(new URL(writes[1]?.[0]).searchParams.get('EntryIds')).toBe('entry-1')
    expect(writes.every(([url]) => new URL(url).pathname === '/Playlists/playlist-1/Items')).toBe(
      true,
    )
  })

  it('collects every page before changing anything and removes old entries in chunks', async () => {
    const fetchMock = exportFetch()
    const entries = Array.from({ length: 250 }, (_, index) => `entry-${index}`)
    mockFetch.mockImplementation(async (url: string, init: RequestInit) => {
      const request = new URL(url)
      if (request.pathname === '/Playlists/playlist-1/Items' && init.method === 'GET') {
        expect(mutations(fetchMock)).toHaveLength(0)
        const start = Number(request.searchParams.get('StartIndex'))
        const page = entries.slice(start, start + 200).map((id) => ({ PlaylistItemId: id }))
        return ok({ Items: page, TotalRecordCount: entries.length })
      }
      return fetchMock(url, init)
    })
    const session = await createJellyfinPlaylistTarget(7, CONFIG).openPlaylistExportSession?.(
      EXPORT_ITEMS,
    )
    expect((await session?.replacePlaylist('playlist-1', 'Picks'))?.success).toBe(true)
    const deletes = mutations(fetchMock).filter(([, init]) => init.method === 'DELETE')
    const removed = deletes.map(([url]) => new URL(url).searchParams.get('EntryIds')?.split(','))
    expect(removed.map((ids) => ids?.length)).toEqual([100, 100, 50])
    expect(removed.flat()).toEqual(entries)
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
    'retains the ID and the old entries on add failure %i and never creates a replacement',
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
      expect(mutations(fetchMock)).toHaveLength(1)
      expect(await session?.replacePlaylist('playlist-1', 'Picks')).toMatchObject({
        success: false,
        playlistId: 'playlist-1',
      })
      expect(mutations(fetchMock).map(([, init]) => init.method)).toEqual(['POST', 'POST'])
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
