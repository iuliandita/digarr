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
})
