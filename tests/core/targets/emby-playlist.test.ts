// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmbyPlaylistTarget } from '@/core/targets/emby-playlist'

describe('createEmbyPlaylistTarget', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('creates a playlist and returns playlist metadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            Items: [{ Id: 'track-1', Name: 'Roygbiv', AlbumArtist: 'Boards of Canada' }],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ Id: 'playlist-1', Name: 'Weekly Discoveries' }),
        }),
    )

    const target = createEmbyPlaylistTarget(9, {
      url: 'http://emby:8096',
      apiKey: 'key',
      userId: 'user-1',
    })

    const result = await target.createPlaylist?.('Weekly Discoveries', [
      { artistName: 'Boards of Canada', artistMbid: 'mbid-1', trackName: 'Roygbiv' },
    ])

    expect(result).toMatchObject({
      success: true,
      targetType: 'emby-playlist',
      playlistId: 'playlist-1',
      itemsAdded: 1,
    })
  })

  it('prefers an exact title+artist match instead of the first near-match', async () => {
    const fetchMock = vi.fn()
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          Items: [
            { Id: 'partial', Name: 'Roygbiv (Live)', AlbumArtist: 'Boards of Canada' },
            { Id: 'exact', Name: 'Roygbiv', AlbumArtist: 'Boards of Canada' },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ Id: 'playlist-1', Name: 'Weekly Discoveries' }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const target = createEmbyPlaylistTarget(9, {
      url: 'http://emby:8096',
      apiKey: 'key',
      userId: 'user-1',
    })

    const result = await target.createPlaylist?.('Weekly Discoveries', [
      { artistName: 'Boards of Canada', artistMbid: 'mbid-1', trackName: 'Roygbiv' },
    ])

    const [, postInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    const body = JSON.parse(postInit.body as string) as { Ids: string[] }
    expect(body.Ids).toEqual(['exact'])
    expect(result).toMatchObject({ success: true, itemsAdded: 1 })
  })

  it('passes Bun TLS skip options when configured', async () => {
    const fetchMock = vi.fn()
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ Items: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ Id: 'playlist-1', Name: 'Weekly Discoveries' }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const target = createEmbyPlaylistTarget(9, {
      url: 'https://emby:8096',
      apiKey: 'key',
      userId: 'user-1',
      skipTlsVerify: true,
    })

    await target.createPlaylist?.('Weekly Discoveries', [])

    const firstCall = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(firstCall[1]).toMatchObject({
      tls: { rejectUnauthorized: false },
    })
  })
})
