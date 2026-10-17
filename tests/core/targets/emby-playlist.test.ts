// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmbyPlaylistTarget } from '@/core/targets/emby-playlist'

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body))
}

const CONFIG = { url: 'http://emby:8096', apiKey: 'key', userId: 'user-1' }
const ITEM = { artistName: 'Boards of Canada', artistMbid: 'mbid-1', trackName: 'Roygbiv' }

function embyFetch(
  options: { search?: () => Promise<Response>; create?: () => Promise<Response> } = {},
) {
  return vi.fn().mockImplementation(async (url: string) => {
    const { pathname } = new URL(url)
    if (pathname === '/System/Info') return ok({ Id: 'emby-server' })
    if (pathname === '/Users/user-1') return ok({ Id: 'user-1', ServerId: 'emby-server' })
    if (pathname === '/Users/user-1/Items') {
      return options.search
        ? options.search()
        : ok({ Items: [{ Id: 'track-1', Name: 'Roygbiv', AlbumArtist: 'Boards of Canada' }] })
    }
    if (pathname === '/Playlists') {
      return options.create ? options.create() : ok({ Id: 'playlist-1' })
    }
    return new Response('Not Found', { status: 404 })
  })
}

function playlistPosts(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([url]) => new URL(String(url)).pathname === '/Playlists')
}

async function createViaSession(config: Parameters<typeof createEmbyPlaylistTarget>[1] = CONFIG) {
  const session = await createEmbyPlaylistTarget(9, config).openPlaylistExportSession?.([ITEM])
  if (!session) throw new Error('Expected an export session')
  return session.createPlaylist('Weekly Discoveries', async () => {})
}

describe('createEmbyPlaylistTarget', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('creates a playlist and returns playlist metadata', async () => {
    vi.stubGlobal('fetch', embyFetch())

    const result = await createViaSession()

    expect(result).toMatchObject({
      success: true,
      targetType: 'emby-playlist',
      playlistId: 'playlist-1',
      itemsAdded: 1,
    })
  })

  it('prefers an exact title+artist match instead of the first near-match', async () => {
    const fetchMock = embyFetch({
      search: async () =>
        ok({
          Items: [
            { Id: 'partial', Name: 'Roygbiv (Live)', AlbumArtist: 'Boards of Canada' },
            { Id: 'exact', Name: 'Roygbiv', AlbumArtist: 'Boards of Canada' },
          ],
        }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await createViaSession()

    const [, postInit] = playlistPosts(fetchMock)[0] as [string, RequestInit]
    const body = JSON.parse(postInit.body as string) as { Ids: string[] }
    expect(body.Ids).toEqual(['exact'])
    expect(result).toMatchObject({ success: true, itemsAdded: 1 })
  })

  it('passes Bun TLS skip options when configured', async () => {
    const fetchMock = embyFetch()
    vi.stubGlobal('fetch', fetchMock)

    await createViaSession({ ...CONFIG, url: 'https://emby:8096', skipTlsVerify: true })

    const firstCall = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(firstCall[1]).toMatchObject({
      tls: { rejectUnauthorized: false },
    })
  })

  it('fails without creating a playlist when track search fails', async () => {
    const fetchMock = embyFetch({
      search: () => Promise.reject(new Error('search transport failed')),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(createViaSession()).rejects.toThrow('search transport failed')
    expect(playlistPosts(fetchMock)).toHaveLength(0)
  })

  it('fails when Emby does not return a playlist ID', async () => {
    vi.stubGlobal('fetch', embyFetch({ create: async () => ok({ Name: 'Weekly Discoveries' }) }))

    expect(await createViaSession()).toMatchObject({
      success: false,
      error: 'Emby did not return a playlist ID',
    })
  })

  it('retains the Emby response body in API errors', async () => {
    const fetchMock = embyFetch({
      create: async () => new Response('playlist database unavailable', { status: 500 }),
    })
    vi.stubGlobal('fetch', fetchMock)

    expect(await createViaSession()).toMatchObject({
      success: false,
      error: 'Emby API 500: playlist database unavailable',
    })
    expect(playlistPosts(fetchMock)).toHaveLength(1)
  })

  it('returns a provider-shaped error for malformed JSON', async () => {
    vi.stubGlobal('fetch', embyFetch({ create: async () => new Response('not-json') }))

    expect(await createViaSession()).toMatchObject({
      success: false,
      error: 'Emby API 200: Invalid JSON: not-json',
    })
  })
})

describe('Emby scheduled playlist session', () => {
  it('uses the verified Emby identity, checkpoints creation, and replaces entries rather than audio IDs', async () => {
    const config = { url: 'http://emby:8096', apiKey: 'emby-secret', userId: 'user-1' }
    const fetchMock = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      const request = new URL(url)
      if (request.pathname === '/System/Info') return ok({ Id: 'emby-server' })
      if (request.pathname === '/Users/user-1') return ok({ Id: 'user-1', ServerId: 'emby-server' })
      if (request.pathname === '/Users/user-1/Items')
        return ok({ Items: [{ Id: 'track-1', Name: 'Roygbiv', AlbumArtist: 'Boards of Canada' }] })
      if (request.pathname === '/Users/user-1/Items/playlist-1')
        return ok({ Id: 'playlist-1', Type: 'Playlist', MediaType: 'Audio', Name: 'Original' })
      if (request.pathname === '/Playlists') return ok({ Id: 'playlist-1' })
      if (init.method === 'GET')
        return ok({ Items: [{ Id: 'audio-1', PlaylistItemId: 'entry-1' }], TotalRecordCount: 1 })
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const session = await createEmbyPlaylistTarget(9, config).openPlaylistExportSession?.([
      { artistName: 'Boards of Canada', artistMbid: 'mbid-1', trackName: 'Roygbiv' },
    ])
    const checkpoint = vi.fn().mockImplementation(async (id: string) => {
      expect(id).toBe('playlist-1')
      expect(fetchMock.mock.calls.filter(([, init]) => init.method !== 'GET')).toHaveLength(1)
    })
    expect(await session?.createPlaylist('Picks', checkpoint)).toMatchObject({
      success: true,
      playlistId: 'playlist-1',
    })
    expect(checkpoint).toHaveBeenCalledOnce()
    expect(await session?.replacePlaylist('playlist-1', 'New name')).toMatchObject({
      success: true,
      playlistId: 'playlist-1',
      playlistName: 'Original',
    })
    const writes = fetchMock.mock.calls.filter(([, init]) => init.method !== 'GET')
    expect(writes.map(([, init]) => init.method)).toEqual(['POST', 'POST', 'DELETE'])
    expect(new URL(writes[1]?.[0]).searchParams.get('Ids')).toBe('track-1')
    expect(new URL(writes[2]?.[0]).searchParams.get('EntryIds')).toBe('entry-1')
  })

  it('redacts transport errors during identity preparation', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network failed emby-secret'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      createEmbyPlaylistTarget(9, {
        url: 'http://emby:8096',
        apiKey: 'emby-secret',
        userId: 'user-1',
      }).openPlaylistExportSession?.([
        { artistName: 'Boards of Canada', artistMbid: 'mbid-1', trackName: 'Roygbiv' },
      ]),
    ).rejects.toThrow('network failed [REDACTED]')
    expect(fetchMock.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true)
  })
})
